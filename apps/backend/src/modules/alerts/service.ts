/**
 * Alert storage. At most one *active* (open/acknowledged) alert per (device, type) — enforced by a
 * partial unique index — so repeated raises bump `count`/`lastSeenAt` instead of duplicating.
 */
import type { AlertCounts, AlertPublic, AlertSeverity, AlertType, AlertsQuery } from '@xeno/shared';
import { Types } from 'mongoose';
import { Alert, Device, type AlertDoc, type DeviceDoc } from '../../db/models.js';
import type { AppBus } from '../../lib/bus.js';
import { badRequest, notFound } from '../../lib/errors.js';

export function toAlertPublic(a: AlertDoc, deviceName: string | null): AlertPublic {
  return {
    id: a._id.toHexString(),
    deviceId: a.deviceId.toHexString(),
    deviceName,
    type: a.type,
    severity: a.severity,
    status: a.status,
    message: a.message,
    count: a.count,
    firstSeenAt: a.firstSeenAt.toISOString(),
    lastSeenAt: a.lastSeenAt.toISOString(),
    acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.toISOString() : null,
    resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    context: a.context ?? {},
  };
}

const encodeCursor = (a: AlertDoc) =>
  Buffer.from(`${a.lastSeenAt.getTime()}:${a._id.toHexString()}`).toString('base64url');
function decodeCursor(cursor: string) {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  const t = Number(ms);
  if (!Number.isFinite(t) || !id || !Types.ObjectId.isValid(id)) throw badRequest('Invalid cursor');
  return { lastSeenAt: new Date(t), id: new Types.ObjectId(id) };
}

export interface RaiseInput {
  deviceId: string;
  ownerId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  context?: Record<string, unknown>;
  at: Date;
}

export function createAlertService({ bus }: { bus: AppBus }) {
  async function deviceName(deviceId: Types.ObjectId | string) {
    const d = await Device.findById(deviceId, { name: 1 }).lean<Pick<DeviceDoc, 'name'>>();
    return d?.name ?? null;
  }

  async function bump(input: RaiseInput): Promise<AlertDoc | null> {
    return Alert.findOneAndUpdate(
      { deviceId: input.deviceId, type: input.type, active: true },
      {
        $set: {
          lastSeenAt: input.at,
          severity: input.severity,
          message: input.message,
          context: input.context ?? {},
        },
        $inc: { count: 1 },
      },
      { returnDocument: 'after' },
    ).lean<AlertDoc>();
  }

  return {
    /** Opens an alert, or bumps the active one of the same type. */
    async raise(input: RaiseInput): Promise<AlertPublic> {
      let doc = await bump(input);
      let opened = false;
      if (!doc) {
        try {
          const created = await Alert.create({
            deviceId: input.deviceId,
            ownerId: input.ownerId,
            type: input.type,
            severity: input.severity,
            message: input.message,
            context: input.context ?? {},
            firstSeenAt: input.at,
            lastSeenAt: input.at,
          });
          doc = created.toObject();
          opened = true;
        } catch (err) {
          if ((err as { code?: number }).code !== 11000) throw err;
          doc = await bump(input); // lost the race to a concurrent raise
          if (!doc) throw err;
        }
      }
      const alert = toAlertPublic(doc, await deviceName(doc.deviceId));
      bus.emit(opened ? 'alert.opened' : 'alert.updated', { ownerId: input.ownerId, alert });
      return alert;
    },

    /** Silently refreshes lastSeenAt of an active alert (no event, no count change). */
    async touch(deviceId: string, type: AlertType, at: Date) {
      await Alert.updateOne({ deviceId, type, active: true }, { $set: { lastSeenAt: at } });
    },

    /** Auto-resolves the active alert of this type, if any. */
    async clear(deviceId: string, type: AlertType, at: Date): Promise<AlertPublic | null> {
      const doc = await Alert.findOneAndUpdate(
        { deviceId, type, active: true },
        { $set: { status: 'resolved', active: false, resolvedAt: at } },
        { returnDocument: 'after' },
      ).lean<AlertDoc>();
      if (!doc) return null;
      const alert = toAlertPublic(doc, await deviceName(doc.deviceId));
      bus.emit('alert.updated', { ownerId: doc.ownerId.toHexString(), alert });
      return alert;
    },

    async hasActive(deviceId: string, type: AlertType) {
      return !!(await Alert.exists({ deviceId, type, active: true }));
    },

    async list(userId: string, q: AlertsQuery) {
      const filter: Record<string, unknown> = { ownerId: new Types.ObjectId(userId) };
      if (q.deviceId) filter.deviceId = new Types.ObjectId(q.deviceId);
      if (q.status?.length) filter.status = { $in: q.status };
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        filter.$or = [
          { lastSeenAt: { $lt: c.lastSeenAt } },
          { lastSeenAt: c.lastSeenAt, _id: { $lt: c.id } },
        ];
      }
      const docs = await Alert.find(filter)
        .sort({ lastSeenAt: -1, _id: -1 })
        .limit(q.limit + 1)
        .lean<AlertDoc[]>();
      const page = docs.slice(0, q.limit);
      const ids = [...new Set(page.map((a) => a.deviceId.toHexString()))];
      const names = new Map(
        (await Device.find({ _id: { $in: ids } }, { name: 1 }).lean<DeviceDoc[]>()).map((d) => [
          d._id.toHexString(),
          d.name,
        ]),
      );
      return {
        items: page.map((a) => toAlertPublic(a, names.get(a.deviceId.toHexString()) ?? null)),
        nextCursor: docs.length > q.limit ? encodeCursor(page[page.length - 1]!) : null,
      };
    },

    async counts(userId: string): Promise<AlertCounts> {
      const ownerId = new Types.ObjectId(userId);
      const [open, critical] = await Promise.all([
        Alert.countDocuments({ ownerId, status: 'open' }),
        Alert.countDocuments({ ownerId, active: true, severity: 'critical' }),
      ]);
      return { open, critical };
    },

    async setStatus(userId: string, id: string, status: 'acknowledged' | 'resolved', at: Date) {
      if (!Types.ObjectId.isValid(id)) throw notFound('Alert');
      const $set =
        status === 'acknowledged'
          ? { status, acknowledgedAt: at }
          : { status, active: false, resolvedAt: at };
      const filter: Record<string, unknown> =
        status === 'acknowledged'
          ? { _id: id, ownerId: userId, status: 'open' }
          : { _id: id, ownerId: userId, active: true };
      const doc =
        (await Alert.findOneAndUpdate(filter, { $set }, { returnDocument: 'after' }).lean<AlertDoc>()) ??
        (await Alert.findOne({ _id: id, ownerId: userId }).lean<AlertDoc>());
      if (!doc) throw notFound('Alert');
      const alert = toAlertPublic(doc, await deviceName(doc.deviceId));
      bus.emit('alert.updated', { ownerId: userId, alert });
      return alert;
    },
  };
}
export type AlertService = ReturnType<typeof createAlertService>;
