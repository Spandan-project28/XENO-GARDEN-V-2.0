/**
 * Push notifications for alerts. Sends when an alert opens; while it stays open and keeps
 * recurring, reminds at most once per REMIND_AFTER. Respects per-user preferences.
 */
import type { AlertPublic, AlertType, NotificationPrefs, PushTokenBody } from '@xeno/shared';
import { Alert, User, type UserDoc } from '../../db/models.js';
import type { AppBus } from '../../lib/bus.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { isExpoPushToken, type PushSender } from './sender.js';

export const REMIND_AFTER_MS = 30 * 60_000;

const TITLES: Record<AlertType, string> = {
  LOW_MOISTURE: '💧 Soil is dry',
  SENSOR_FAULT: '⚠️ Sensor problem',
  DEVICE_OFFLINE: '📡 Device offline',
  PUMP_MAX_RUNTIME: '🚰 Pump safety stop',
  HIGH_TEMP: '🌡️ Heat warning',
  PLANT_HEALTH: '🌿 Plant health',
};

export interface NotificationDeps {
  bus: AppBus;
  sender: PushSender;
  now: () => Date;
  log: { warn: (o: object, m: string) => void };
}

export function createNotificationService({ bus, sender, now, log }: NotificationDeps) {
  async function notify(ownerId: string, alert: AlertPublic, reminder: boolean) {
    const user = await User.findById(ownerId, { pushTokens: 1, notificationPrefs: 1 }).lean<UserDoc>();
    if (!user?.pushTokens.length) return;
    const prefs = user.notificationPrefs ?? { enabled: true, types: {} };
    if (!prefs.enabled || prefs.types?.[alert.type] === false) return;

    // Claim the right to notify atomically so concurrent events can't double-send.
    const t = now();
    const claimed = await Alert.findOneAndUpdate(
      {
        _id: alert.id,
        active: true,
        $or: [{ lastNotifiedAt: null }, { lastNotifiedAt: { $lte: new Date(t.getTime() - REMIND_AFTER_MS) } }],
      },
      { $set: { lastNotifiedAt: t } },
    );
    if (!claimed) return;

    const title = TITLES[alert.type];
    const body = reminder ? `Still happening (×${alert.count}). ${alert.message}` : alert.message;
    const results = await sender.send(
      user.pushTokens.map((pt) => ({
        to: pt.token,
        title,
        body,
        sound: 'default' as const,
        priority: alert.severity === 'critical' ? ('high' as const) : ('default' as const),
        channelId: 'alerts',
        data: { type: 'alert', alertId: alert.id, deviceId: alert.deviceId, url: `/alerts?focus=${alert.id}` },
      })),
    );
    const dead = results.filter((r) => r.unregistered).map((r) => r.token);
    if (dead.length) {
      await User.updateOne({ _id: ownerId }, { $pull: { pushTokens: { token: { $in: dead } } } });
    }
    const failed = results.filter((r) => !r.ok && !r.unregistered);
    if (failed.length) log.warn({ failed: failed.length, error: failed[0]?.error }, 'push delivery failed');
  }

  const offs = [
    bus.on('alert.opened', (e) => notify(e.ownerId, e.alert, false)),
    bus.on('alert.updated', (e) => {
      if (e.alert.status === 'open' && e.alert.count > 1) return notify(e.ownerId, e.alert, true);
    }),
  ];

  return {
    notify,
    async registerToken(userId: string, body: PushTokenBody) {
      if (!isExpoPushToken(body.token)) throw badRequest('Not an Expo push token');
      // A phone belongs to whoever is signed in on it now.
      await User.updateMany({ _id: { $ne: userId } }, { $pull: { pushTokens: { token: body.token } } });
      await User.updateOne({ _id: userId }, { $pull: { pushTokens: { token: body.token } } });
      const r = await User.updateOne(
        { _id: userId },
        { $push: { pushTokens: { $each: [{ ...body, updatedAt: now() }], $slice: -10 } } },
      );
      if (!r.matchedCount) throw notFound('User');
    },
    async removeToken(userId: string, token: string) {
      await User.updateOne({ _id: userId }, { $pull: { pushTokens: { token } } });
    },
    async getPrefs(userId: string): Promise<NotificationPrefs> {
      const u = await User.findById(userId, { notificationPrefs: 1 }).lean<UserDoc>();
      if (!u) throw notFound('User');
      return { enabled: u.notificationPrefs?.enabled ?? true, types: u.notificationPrefs?.types ?? {} };
    },
    async setPrefs(userId: string, prefs: NotificationPrefs): Promise<NotificationPrefs> {
      await User.updateOne({ _id: userId }, { $set: { notificationPrefs: prefs } });
      return prefs;
    },
    stop() {
      offs.forEach((off) => off());
    },
  };
}
export type NotificationService = ReturnType<typeof createNotificationService>;
