/**
 * Alert rules. Conditions must hold for a while before an alert opens and must stay clear for a
 * while before it auto-resolves, so flapping sensors or brief WiFi drops don't spam the user.
 *
 * | type             | opens when                                              | resolves when                  |
 * |------------------|---------------------------------------------------------|--------------------------------|
 * | LOW_MOISTURE     | soil < moistureLow for ALERT_LOW_MOISTURE_MINUTES       | soil ≥ moistureLow for 2 min   |
 * | SENSOR_FAULT     | soil reading missing for 1 min (or device event)        | valid readings for 2 min       |
 * | HIGH_TEMP        | temperature ≥ highTempC for 10 min                      | < highTempC − 2 °C for 5 min   |
 * | DEVICE_OFFLINE   | offline for 3 min (checked by tick())                   | device back online             |
 * | PUMP_MAX_RUNTIME | device stops the pump for max_runtime                   | next normal watering ends wet  |
 */
import type { AlertSeverity, AlertType, DeviceSettings } from '@xeno/shared';
import { Alert, Device, type DeviceDoc } from '../../db/models.js';
import type { AppBus } from '../../lib/bus.js';
import type { AlertService } from './service.js';

const MIN = 60_000;
export const OFFLINE_GRACE_MS = 3 * MIN;
const TOUCH_EVERY_MS = MIN;

interface Track {
  activeSince: number | null;
  clearSince: number | null;
  raised: boolean;
  lastTouch: number;
}

/** Tracks one condition per (device, type) with open/clear delays. */
export class ConditionTracker {
  private readonly tracks = new Map<string, Track>();

  /**
   * Feeds the current truth of a condition. Returns what the caller should do.
   * `unknown` (e.g. no reading) leaves the state untouched.
   */
  update(
    key: string,
    active: boolean,
    now: number,
    openAfterMs: number,
    clearAfterMs: number,
  ): 'raise' | 'clear' | 'touch' | null {
    const t = this.tracks.get(key) ?? { activeSince: null, clearSince: null, raised: false, lastTouch: 0 };
    this.tracks.set(key, t);
    if (active) {
      t.clearSince = null;
      t.activeSince ??= now;
      if (!t.raised && now - t.activeSince >= openAfterMs) {
        t.raised = true;
        t.lastTouch = now;
        return 'raise';
      }
      if (t.raised && now - t.lastTouch >= TOUCH_EVERY_MS) {
        t.lastTouch = now;
        return 'touch';
      }
      return null;
    }
    t.activeSince = null;
    t.clearSince ??= now;
    if (t.raised && now - t.clearSince >= clearAfterMs) {
      t.raised = false;
      return 'clear';
    }
    return null;
  }

  /** Marks a condition as raised/cleared by an external signal (device event, status). */
  set(key: string, raised: boolean, now: number) {
    this.tracks.set(key, { activeSince: raised ? now : null, clearSince: raised ? null : now, raised, lastTouch: now });
  }

  forget(prefix: string) {
    for (const k of this.tracks.keys()) if (k.startsWith(prefix)) this.tracks.delete(k);
  }
}

export interface AlertEngineDeps {
  bus: AppBus;
  alerts: AlertService;
  lowMoistureMinutes: number;
}

type DeviceSnapshot = Pick<DeviceDoc, '_id' | 'name'> & { desired: { settings: DeviceSettings } };

export function createAlertEngine({ bus, alerts, lowMoistureMinutes }: AlertEngineDeps) {
  const tracker = new ConditionTracker();
  const key = (deviceId: string, type: AlertType) => `${deviceId}:${type}`;

  async function act(
    action: ReturnType<ConditionTracker['update']>,
    base: { deviceId: string; ownerId: string; at: Date },
    type: AlertType,
    severity: AlertSeverity,
    message: string,
    context: Record<string, unknown>,
  ) {
    if (action === 'raise') await alerts.raise({ ...base, type, severity, message, context });
    else if (action === 'touch') await alerts.touch(base.deviceId, type, base.at);
    else if (action === 'clear') await alerts.clear(base.deviceId, type, base.at);
  }

  async function onTelemetry(e: {
    deviceId: string;
    ownerId: string;
    ts: Date;
    payload: { soilMoisture: number | null; temperature: number | null };
  }) {
    const d = await Device.findById(e.deviceId, { name: 1, 'desired.settings': 1 }).lean<DeviceSnapshot>();
    if (!d) return;
    const s = d.desired.settings;
    const now = e.ts.getTime();
    const base = { deviceId: e.deviceId, ownerId: e.ownerId, at: e.ts };
    const soil = e.payload.soilMoisture;

    await act(
      tracker.update(key(e.deviceId, 'SENSOR_FAULT'), soil === null, now, MIN, 2 * MIN),
      base,
      'SENSOR_FAULT',
      'critical',
      `${d.name}: the soil moisture sensor isn't responding. Automatic watering is paused.`,
      {},
    );

    if (soil !== null) {
      const critical = soil < Math.max(5, s.moistureLow - 15);
      await act(
        tracker.update(
          key(e.deviceId, 'LOW_MOISTURE'),
          soil < s.moistureLow,
          now,
          lowMoistureMinutes * MIN,
          2 * MIN,
        ),
        base,
        'LOW_MOISTURE',
        critical ? 'critical' : 'warning',
        `${d.name}: soil has stayed dry (${Math.round(soil)}%) for over ${lowMoistureMinutes} min. Check the water supply.`,
        { soilMoisture: soil, threshold: s.moistureLow },
      );
    }

    const temp = e.payload.temperature;
    if (temp !== null) {
      const k = key(e.deviceId, 'HIGH_TEMP');
      const hot = temp >= s.highTempC;
      const cooled = temp < s.highTempC - 2;
      // Between the two thresholds the condition keeps its previous state.
      if (hot || cooled) {
        await act(
          tracker.update(k, hot, now, 10 * MIN, 5 * MIN),
          base,
          'HIGH_TEMP',
          'warning',
          `${d.name}: it's very hot (${temp.toFixed(1)}°C). Plants may need shade or extra water.`,
          { temperature: temp, threshold: s.highTempC },
        );
      }
    }
  }

  const offs = [
    bus.on('device.telemetry', onTelemetry),

    bus.on('device.event', async (e) => {
      const base = { deviceId: e.deviceId, ownerId: e.ownerId, at: e.at };
      if (e.event.type === 'sensor_fault') {
        tracker.set(key(e.deviceId, 'SENSOR_FAULT'), true, e.at.getTime());
        const name = (await Device.findById(e.deviceId, { name: 1 }).lean<DeviceSnapshot>())?.name ?? 'Device';
        await alerts.raise({
          ...base,
          type: 'SENSOR_FAULT',
          severity: 'critical',
          message: `${name}: a sensor stopped responding. Automatic watering is paused.`,
          context: e.event.data,
        });
      }
    }),

    bus.on('device.reported', async (e) => {
      const base = { deviceId: e.deviceId, ownerId: e.ownerId, at: e.at };
      if (e.reported.pumpReason === 'max_runtime' && !e.reported.pump) {
        const name = (await Device.findById(e.deviceId, { name: 1 }).lean<DeviceSnapshot>())?.name ?? 'Device';
        await alerts.raise({
          ...base,
          type: 'PUMP_MAX_RUNTIME',
          severity: 'warning',
          message: `${name}: the pump ran for its maximum time without the soil getting wet. Is the water tank empty or a pipe blocked?`,
          context: {},
        });
      } else if (e.reported.pumpReason === 'wet') {
        await alerts.clear(e.deviceId, 'PUMP_MAX_RUNTIME', e.at);
      }
    }),

    bus.on('device.status', async (e) => {
      if (e.online) await alerts.clear(e.deviceId, 'DEVICE_OFFLINE', e.at);
    }),

    bus.on('device.removed', async (e) => {
      tracker.forget(`${e.deviceId}:`);
      await Alert.updateMany(
        { deviceId: e.deviceId, active: true },
        { $set: { status: 'resolved', active: false, resolvedAt: new Date() } },
      );
    }),
  ];

  return {
    tracker,
    /** Exposed for tests; in production it runs from the bus listener. */
    handleTelemetry: onTelemetry,
    /** Periodic checks that can't be driven by incoming messages (run by the runtime). */
    async tick(now: Date) {
      const stale = await Device.find(
        { online: false, lastSeenAt: { $ne: null, $lt: new Date(now.getTime() - OFFLINE_GRACE_MS) } },
        { name: 1, ownerId: 1, lastSeenAt: 1 },
      ).lean<DeviceDoc[]>();
      for (const d of stale) {
        const deviceId = d._id.toHexString();
        if (await alerts.hasActive(deviceId, 'DEVICE_OFFLINE')) continue;
        await alerts.raise({
          deviceId,
          ownerId: d.ownerId.toHexString(),
          type: 'DEVICE_OFFLINE',
          severity: 'warning',
          message: `${d.name} is offline. Check its power and WiFi. It keeps watering on its own schedule.`,
          context: { lastSeenAt: d.lastSeenAt?.toISOString() },
          at: now,
        });
      }
    },
    stop() {
      offs.forEach((off) => off());
    },
  };
}
export type AlertEngine = ReturnType<typeof createAlertEngine>;
