/**
 * Device shadow: the only writer of `desired`. Every change bumps `desired.version` and is
 * published retained to `xg/v1/{hw}/desired` so a device that (re)connects always gets it.
 * Also stores `reported` from the device (the only writer of `reported`).
 */
import {
  deviceSettings,
  type CommandAckPayload,
  type DesiredState,
  type DeviceCommandType,
  type DeviceMode,
  type DevicePublic,
  type DeviceSettingsPatch,
  type PumpCommandBody,
  type PumpCommandResponse,
  type ReportedPayload,
} from '@xeno/shared';
import { nanoid } from 'nanoid';
import { Device, type DeviceDoc } from '../../db/models.js';
import type { AppBus } from '../../lib/bus.js';
import { AppError } from '../../lib/errors.js';
import type { DeviceService } from '../devices/service.js';
import { toDevicePublic } from '../devices/service.js';
import type { DevicePublisher } from './publisher.js';

const DEFAULT_ON_SEC = 600;
const DEFAULT_PAUSE_SEC = 1800;
const MAX_CAS_RETRIES = 12;
const backoff = (attempt: number) =>
  new Promise((r) => setTimeout(r, Math.random() * 5 * (attempt + 1)));

export interface ControlLogger {
  warn: (obj: object, msg: string) => void;
}

export interface ControlServiceDeps {
  devices: DeviceService;
  publisher: DevicePublisher;
  bus: AppBus;
  now: () => Date;
  log: ControlLogger;
}

export function createControlService({ devices, publisher, bus, now, log }: ControlServiceDeps) {
  /**
   * Compare-and-swap update of `desired`: recomputes from the latest document and retries if
   * another writer bumped the version in between. Publishes the result.
   */
  async function mutateDesired(
    userId: string,
    id: string,
    change: (current: DesiredState, d: DeviceDoc) => Omit<DesiredState, 'version'>,
  ): Promise<DeviceDoc> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const d = await devices.getOwned(userId, id);
      const next: DesiredState = { ...change(d.desired, d), version: d.desired.version + 1 };
      const updated = await Device.findOneAndUpdate(
        { _id: d._id, 'desired.version': d.desired.version },
        { $set: { desired: next } },
        { new: true },
      ).lean<DeviceDoc>();
      if (!updated) {
        await backoff(attempt);
        continue;
      }
      await publish(updated);
      return updated;
    }
    throw new AppError('CONFLICT', 'Device was changed concurrently, please retry');
  }

  async function publish(d: DeviceDoc) {
    try {
      await publisher.publishDesired(d.hardwareId, d.desired);
    } catch (err) {
      // Stored in DB; republished on the next gateway (re)connect.
      log.warn({ err, hardwareId: d.hardwareId }, 'desired publish deferred');
    }
    bus.emit('device.desired', {
      deviceId: d._id.toHexString(),
      ownerId: d.ownerId.toHexString(),
      desired: d.desired,
    });
  }

  function requireOnline(d: DeviceDoc) {
    if (!d.online) {
      throw new AppError('DEVICE_OFFLINE', 'The device is offline. Check its power and WiFi.');
    }
  }

  return {
    async updateSettings(userId: string, id: string, patch: DeviceSettingsPatch): Promise<DevicePublic> {
      const d = await mutateDesired(userId, id, (cur) => {
        const merged = deviceSettings.safeParse({ ...cur.settings, ...patch });
        if (!merged.success) {
          throw new AppError(
            'VALIDATION_FAILED',
            merged.error.issues[0]?.message ?? 'Invalid settings',
            merged.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          );
        }
        return { ...cur, settings: merged.data };
      });
      return toDevicePublic(d);
    },

    async setMode(userId: string, id: string, mode: DeviceMode): Promise<DevicePublic> {
      // Switching mode cancels any manual command so behaviour is predictable.
      const d = await mutateDesired(userId, id, (cur) => ({ ...cur, mode, manual: null }));
      return toDevicePublic(d);
    },

    /**
     * ON: water now for `durationSec` (capped at maxPumpRunSec). OFF in auto mode: pause
     * automation for `durationSec`. OFF in manual mode: stop and clear the command.
     */
    async pump(userId: string, id: string, body: PumpCommandBody): Promise<PumpCommandResponse> {
      requireOnline(await devices.getOwned(userId, id));
      const cmdId = nanoid(12);
      const d = await mutateDesired(userId, id, (cur) => {
        if (body.action === 'OFF' && cur.mode === 'manual') return { ...cur, manual: null };
        const issuedAt = now().getTime();
        const durationSec =
          body.action === 'ON'
            ? Math.min(body.durationSec ?? DEFAULT_ON_SEC, cur.settings.maxPumpRunSec)
            : (body.durationSec ?? DEFAULT_PAUSE_SEC);
        return {
          ...cur,
          manual: { cmdId, pump: body.action, durationSec, issuedAt, expiresAt: issuedAt + durationSec * 1000 },
        };
      });
      return { cmdId, device: toDevicePublic(d) };
    },

    async sendCommand(userId: string, id: string, type: DeviceCommandType): Promise<{ cmdId: string }> {
      const d = await devices.getOwned(userId, id);
      requireOnline(d);
      const cmdId = nanoid(12);
      await publisher.publishCommand(d.hardwareId, { cmdId, type, issuedAt: now().getTime() });
      return { cmdId };
    },

    /** Device → cloud reported state. */
    /** Returns the device id (for follow-up processing), or null for unknown devices. */
    async onReported(hardwareId: string, reported: ReportedPayload, at: Date): Promise<string | null> {
      const d = await Device.findOneAndUpdate(
        { hardwareId },
        { $set: { reported: { ...reported, at }, firmwareVersion: reported.fwVersion, lastSeenAt: at } },
        { new: true },
      ).lean<DeviceDoc>();
      if (!d) return null;
      bus.emit('device.reported', {
        deviceId: d._id.toHexString(),
        ownerId: d.ownerId.toHexString(),
        reported,
        at,
      });

      // The device dropped a manual command on its own (max runtime, cooldown refusal, expiry):
      // clear it from desired so a reboot doesn't replay it.
      const m = d.desired.manual;
      if (m && reported.appliedVersion >= d.desired.version && reported.manualCmdId !== m.cmdId) {
        const next: DesiredState = { ...d.desired, manual: null, version: d.desired.version + 1 };
        const cleared = await Device.findOneAndUpdate(
          { _id: d._id, 'desired.version': d.desired.version },
          { $set: { desired: next } },
          { new: true },
        ).lean<DeviceDoc>();
        if (cleared) await publish(cleared);
      }
      return d._id.toHexString();
    },

    async onCmdAck(hardwareId: string, ack: CommandAckPayload) {
      const d = await Device.findOne({ hardwareId }, { _id: 1, ownerId: 1 }).lean<DeviceDoc>();
      if (!d) return;
      bus.emit('device.cmdAck', { deviceId: d._id.toHexString(), ownerId: d.ownerId.toHexString(), ack });
    },

    /** Re-publishes every device's desired state (retained) — after broker/backend restarts. */
    async republishAll(): Promise<number> {
      let n = 0;
      for await (const d of Device.find({}, { hardwareId: 1, desired: 1 }).lean<DeviceDoc>().cursor()) {
        await publisher.publishDesired(d.hardwareId, d.desired);
        n++;
      }
      return n;
    },
  };
}
export type ControlService = ReturnType<typeof createControlService>;
