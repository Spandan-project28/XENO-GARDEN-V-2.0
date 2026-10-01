import {
  defaultSettings,
  nextDefaultDeviceName,
  type ClaimBody,
  type ClaimResponse,
  type DesiredState,
  type DevicePublic,
  type UpdateDeviceBody,
} from '@xeno/shared';
import { Types } from 'mongoose';
import { Device, Plant, type DeviceDoc } from '../../db/models.js';
import type { Env } from '../../config/env.js';
import type { AppBus } from '../../lib/bus.js';
import { randomToken, safeEqualHex, sha256 } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/errors.js';

export const initialDesired = (): DesiredState => ({
  version: 1,
  mode: 'auto',
  settings: { ...defaultSettings },
  manual: null,
});

export function toDevicePublic(d: DeviceDoc): DevicePublic {
  return {
    id: d._id.toHexString(),
    hardwareId: d.hardwareId,
    name: d.name,
    plantId: d.plantId ? d.plantId.toHexString() : null,
    online: d.online,
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    claimedAt: d.claimedAt.toISOString(),
    firmwareVersion: d.firmwareVersion,
    desired: d.desired,
    reported: d.reported ? { ...d.reported, at: new Date(d.reported.at).toISOString() } : null,
    latest: d.latest ? { ...d.latest, ts: new Date(d.latest.ts).toISOString() } : null,
    syncPending: !d.reported || d.reported.appliedVersion < d.desired.version,
  };
}

/** "Xeno 1", "Xeno 2", …: the lowest number not used by this owner's other devices. */
async function defaultName(ownerId: string): Promise<string> {
  const names = await Device.find({ ownerId }, { name: 1 }).lean<{ name: string }[]>();
  return nextDefaultDeviceName(names.map((d) => d.name));
}

export interface DeviceServiceDeps {
  env: Env;
  bus: AppBus;
  now: () => Date;
}

export function createDeviceService({ env, bus, now }: DeviceServiceDeps) {
  /** Loads a device only if `userId` owns it. Other people's devices look like 404s. */
  async function getOwned(userId: string, id: string): Promise<DeviceDoc> {
    if (!Types.ObjectId.isValid(id)) throw notFound('Device');
    const d = await Device.findOne({ _id: id, ownerId: userId }).lean<DeviceDoc>();
    if (!d) throw notFound('Device');
    return d;
  }

  return {
    getOwned,

    /**
     * Claims (or re-claims) a device. The claim code is read from the device over BLE in pairing
     * mode, so presenting it proves physical access. A device owned by someone else can only be
     * taken over with its claim code; every claim rotates the device's MQTT password (ADR-011).
     */
    async claim(userId: string, body: ClaimBody): Promise<ClaimResponse> {
      const codeHash = sha256(body.claimCode);
      const mqttPassword = randomToken(24);
      const t = now();
      const existing = await Device.findOne({ hardwareId: body.hardwareId }).lean<DeviceDoc>();

      let device: DeviceDoc;
      if (!existing) {
        const created = await Device.create({
          hardwareId: body.hardwareId,
          ownerId: userId,
          name: body.name ?? (await defaultName(userId)),
          claimCodeHash: codeHash,
          claimedAt: t,
          mqttPasswordHash: sha256(mqttPassword),
          desired: initialDesired(),
        }).catch((err: { code?: number }) => {
          if (err.code === 11000) {
            throw new AppError('CONFLICT', 'Device is being claimed by another request, try again');
          }
          throw err;
        });
        device = created.toObject();
      } else {
        const sameOwner = existing.ownerId.toHexString() === userId;
        if (!sameOwner && !safeEqualHex(existing.claimCodeHash, codeHash)) {
          throw new AppError(
            'DEVICE_ALREADY_CLAIMED',
            'This device is linked to another account. Ask its owner to remove it first.',
          );
        }
        if (!sameOwner) {
          bus.emit('device.removed', {
            deviceId: existing._id.toHexString(),
            ownerId: existing.ownerId.toHexString(),
            hardwareId: existing.hardwareId,
          });
        }
        const updated = await Device.findByIdAndUpdate(
          existing._id,
          {
            $set: {
              ownerId: new Types.ObjectId(userId),
              claimCodeHash: codeHash,
              claimedAt: t,
              mqttPasswordHash: sha256(mqttPassword),
              ...(sameOwner ? {} : { name: body.name ?? (await defaultName(userId)), plantId: null }),
              ...(body.name && sameOwner ? { name: body.name } : {}),
            },
          },
          { returnDocument: 'after' },
        ).lean<DeviceDoc>();
        if (!updated) throw notFound('Device');
        device = updated;
      }

      bus.emit('device.claimed', {
        deviceId: device._id.toHexString(),
        ownerId: userId,
        hardwareId: device.hardwareId,
        desired: device.desired,
      });

      return {
        device: toDevicePublic(device),
        mqtt: {
          host: env.DEVICE_BROKER_HOST,
          port: env.DEVICE_BROKER_PORT,
          tls: env.DEVICE_BROKER_TLS,
          username: device.hardwareId,
          password: mqttPassword,
        },
      };
    },

    async list(userId: string): Promise<DevicePublic[]> {
      const docs = await Device.find({ ownerId: userId }).sort({ claimedAt: 1 }).lean<DeviceDoc[]>();
      return docs.map(toDevicePublic);
    },

    async get(userId: string, id: string): Promise<DevicePublic> {
      return toDevicePublic(await getOwned(userId, id));
    },

    async update(userId: string, id: string, body: UpdateDeviceBody): Promise<DevicePublic> {
      await getOwned(userId, id);
      if (body.plantId) {
        const plant = await Plant.exists({ _id: body.plantId, ownerId: userId });
        if (!plant) throw notFound('Plant');
      }
      const $set: Record<string, unknown> = {};
      if (body.name !== undefined) $set.name = body.name;
      if (body.plantId !== undefined) $set.plantId = body.plantId;
      const d = await Device.findByIdAndUpdate(id, { $set }, { returnDocument: 'after' }).lean<DeviceDoc>();
      if (!d) throw notFound('Device');
      return toDevicePublic(d);
    },

    async remove(userId: string, id: string): Promise<void> {
      const d = await getOwned(userId, id);
      await Device.deleteOne({ _id: d._id });
      bus.emit('device.removed', { deviceId: id, ownerId: userId, hardwareId: d.hardwareId });
    },

    /** Used by the MQTT broker to authenticate device connections. */
    async verifyMqttCredentials(hardwareId: string, password: string): Promise<boolean> {
      const d = await Device.findOne({ hardwareId }, { mqttPasswordHash: 1 }).lean<DeviceDoc>();
      return !!d && safeEqualHex(d.mqttPasswordHash, sha256(password));
    },
  };
}
export type DeviceService = ReturnType<typeof createDeviceService>;
