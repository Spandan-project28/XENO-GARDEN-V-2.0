/**
 * Handles device uplink that is about *measurements and liveness*: telemetry, status (LWT), events.
 * Stores readings, keeps `devices.latest/online/lastSeenAt` fresh and publishes bus events.
 */
import type { EventPayload, TelemetryPayload } from '@xeno/shared';
import { Device, Reading, type DeviceDoc } from '../../db/models.js';
import type { AppBus } from '../../lib/bus.js';

/** Device clocks (NTP) within this window of server time are trusted. */
const MAX_CLOCK_SKEW_MS = 10 * 60_000;

export interface IngestLogger {
  warn: (obj: object, msg: string) => void;
}

export interface TelemetryIngestDeps {
  bus: AppBus;
  log: IngestLogger;
}

type DeviceRef = Pick<DeviceDoc, '_id' | 'ownerId' | 'online'>;

export function createTelemetryIngest({ bus, log }: TelemetryIngestDeps) {
  async function resolve(hardwareId: string): Promise<DeviceRef | null> {
    const d = await Device.findOne({ hardwareId }, { _id: 1, ownerId: 1, online: 1 }).lean<DeviceRef>();
    if (!d) log.warn({ hardwareId }, 'message from unclaimed device ignored');
    return d;
  }

  const ids = (d: DeviceRef) => ({ deviceId: d._id.toHexString(), ownerId: d.ownerId.toHexString() });

  async function markOnline(d: DeviceRef, at: Date) {
    if (d.online) return;
    await Device.updateOne({ _id: d._id }, { $set: { online: true } });
    bus.emit('device.status', { ...ids(d), online: true, at });
  }

  return {
    async telemetry(hardwareId: string, p: TelemetryPayload, receivedAt: Date) {
      const d = await resolve(hardwareId);
      if (!d) return;
      const ts =
        p.ts && Math.abs(p.ts - receivedAt.getTime()) <= MAX_CLOCK_SKEW_MS ? new Date(p.ts) : receivedAt;

      await Reading.create({
        ts,
        deviceId: d._id,
        soilMoisture: p.soilMoisture,
        soilRaw: p.soilRaw,
        temperature: p.temperature,
        humidity: p.humidity,
        rain: p.rain,
        pump: p.pump,
      });
      await Device.updateOne(
        { _id: d._id },
        {
          $set: {
            lastSeenAt: receivedAt,
            latest: {
              ts,
              soilMoisture: p.soilMoisture,
              temperature: p.temperature,
              humidity: p.humidity,
              rain: p.rain,
              pump: p.pump,
            },
          },
        },
      );
      await markOnline(d, receivedAt);
      bus.emit('device.telemetry', { ...ids(d), ts, payload: p });
    },

    async status(hardwareId: string, online: boolean, at: Date) {
      const d = await resolve(hardwareId);
      if (!d) return;
      if (online) {
        await Device.updateOne({ _id: d._id }, { $set: { lastSeenAt: at } });
        return markOnline(d, at);
      }
      if (!d.online) return;
      await Device.updateOne({ _id: d._id }, { $set: { online: false } });
      bus.emit('device.status', { ...ids(d), online: false, at });
    },

    async event(hardwareId: string, event: EventPayload, at: Date) {
      const d = await resolve(hardwareId);
      if (!d) return;
      bus.emit('device.event', { ...ids(d), event, at });
    },

    /**
     * Marks devices offline that stopped sending telemetry without an LWT (e.g. broker restart).
     * Called periodically by the runtime. Returns the number of devices marked offline.
     */
    async sweepStale(now: Date, offlineAfterMs: (d: DeviceDoc) => number): Promise<number> {
      const candidates = await Device.find({ online: true }).lean<DeviceDoc[]>();
      let n = 0;
      for (const d of candidates) {
        const last = d.lastSeenAt?.getTime() ?? 0;
        if (now.getTime() - last <= offlineAfterMs(d)) continue;
        const r = await Device.updateOne({ _id: d._id, online: true }, { $set: { online: false } });
        if (r.modifiedCount) {
          n++;
          bus.emit('device.status', { ...ids(d), online: false, at: now });
        }
      }
      return n;
    },
  };
}
export type TelemetryIngest = ReturnType<typeof createTelemetryIngest>;
