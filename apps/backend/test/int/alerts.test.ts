import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Alert, Device } from '../../src/db/models.js';
import type { BusEvents } from '../../src/lib/bus.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';
import { waitFor } from '../helpers/mqtt.js';

let t: TestApp;
let headers: { authorization: string };
let userId: string;
let deviceId: string;
const MIN = 60_000;
const T0 = new Date('2026-05-01T10:00:00Z').getTime();
let emitted: { name: string; data: BusEvents['alert.opened'] }[];

beforeAll(async () => {
  await startMongo();
  t = await createTestApp({ ALERT_LOW_MOISTURE_MINUTES: '10' });
  emitted = [];
  t.deps.bus.on('alert.opened', (d) => void emitted.push({ name: 'opened', data: d }));
  t.deps.bus.on('alert.updated', (d) => void emitted.push({ name: 'updated', data: d }));
});
afterAll(async () => {
  t.deps.services.alertEngine.stop();
  await t.app.close();
  await stopMongo();
});
beforeEach(async () => {
  await clearDb();
  emitted.length = 0;
  const u = await t.signUp();
  headers = u.headers;
  userId = u.userId;
  deviceId = (
    await t.app.inject({
      method: 'POST',
      url: '/v1/devices/claim',
      headers,
      payload: { hardwareId: `xg-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`, claimCode: 'ABCD2345' },
    })
  ).json().device.id;
  t.deps.services.alertEngine.tracker.forget('');
});

const tele = (ms: number, soil: number | null, temp: number | null = 25) =>
  t.deps.services.alertEngine.handleTelemetry({
    deviceId,
    ownerId: userId,
    ts: new Date(T0 + ms),
    payload: { soilMoisture: soil, temperature: temp },
  });

describe('alert engine', () => {
  it('LOW_MOISTURE opens only after sustained dryness and dedupes 1000 events', async () => {
    for (let s = 0; s < 1000; s++) await tele(s * 5000, 20); // ~83 min of dry readings
    const alerts = await Alert.find().lean();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'LOW_MOISTURE', severity: 'warning', count: 1, status: 'open' });
    expect(alerts[0]!.firstSeenAt.getTime()).toBe(T0 + 10 * MIN);
    expect(alerts[0]!.lastSeenAt.getTime()).toBeGreaterThan(T0 + 80 * MIN); // touched, not duplicated
    expect(emitted.filter((e) => e.name === 'opened')).toHaveLength(1);
  });

  it('does not alert for short dry spells the pump fixes', async () => {
    for (let s = 0; s < 100; s++) await tele(s * 5000, s < 60 ? 20 : 50); // 5 min dry then wet
    expect(await Alert.countDocuments()).toBe(0);
  });

  it('auto-resolves once moisture recovers for 2 minutes', async () => {
    await tele(0, 20);
    await tele(10 * MIN, 20);
    await tele(11 * MIN, 50);
    expect((await Alert.findOne().lean())?.status).toBe('open');
    await tele(13 * MIN, 50);
    const a = await Alert.findOne().lean();
    expect(a).toMatchObject({ status: 'resolved', active: false });
  });

  it('critical severity when far below threshold', async () => {
    await tele(0, 5);
    await tele(10 * MIN, 5);
    expect((await Alert.findOne().lean())?.severity).toBe('critical');
  });

  it('SENSOR_FAULT after a minute of missing soil readings', async () => {
    await tele(0, null);
    await tele(30_000, null);
    expect(await Alert.countDocuments()).toBe(0);
    await tele(60_000, null);
    expect((await Alert.findOne().lean())?.type).toBe('SENSOR_FAULT');
  });

  it('HIGH_TEMP with hysteresis', async () => {
    await tele(0, 40, 39);
    await tele(10 * MIN, 40, 38.5);
    expect((await Alert.findOne({ type: 'HIGH_TEMP' }).lean())?.status).toBe('open');
    await tele(11 * MIN, 40, 37); // between thresholds: no change
    await tele(20 * MIN, 40, 37);
    expect((await Alert.findOne({ type: 'HIGH_TEMP' }).lean())?.status).toBe('open');
    await tele(21 * MIN, 40, 35);
    await tele(26 * MIN, 40, 35);
    expect((await Alert.findOne({ type: 'HIGH_TEMP' }).lean())?.status).toBe('resolved');
  });

  it('DEVICE_OFFLINE after the grace period, cleared when back online', async () => {
    await Device.updateOne({ _id: deviceId }, { online: false, lastSeenAt: new Date(T0) });
    await t.deps.services.alertEngine.tick(new Date(T0 + 2 * MIN));
    expect(await Alert.countDocuments()).toBe(0);
    await t.deps.services.alertEngine.tick(new Date(T0 + 4 * MIN));
    await t.deps.services.alertEngine.tick(new Date(T0 + 5 * MIN));
    expect(await Alert.countDocuments({ type: 'DEVICE_OFFLINE', active: true })).toBe(1);
    t.deps.bus.emit('device.status', { deviceId, ownerId: userId, online: true, at: new Date(T0 + 6 * MIN) });
    await waitFor(async () => (await Alert.countDocuments({ active: true })) === 0);
  });

  it('PUMP_MAX_RUNTIME from reported state; clears after a normal watering', async () => {
    const reported = {
      appliedVersion: 1, mode: 'auto' as const, pump: false, pumpReason: 'max_runtime' as const,
      manualCmdId: null, manualRemainingSec: null, cooldownRemainingSec: 300, fwVersion: '2.0.0',
      rssi: -50, ssid: 'x', ip: null, uptimeSec: 1, heapFree: 1, soilCalibrated: true,
    };
    t.deps.bus.emit('device.reported', { deviceId, ownerId: userId, reported, at: new Date(T0) });
    await waitFor(async () => (await Alert.countDocuments({ type: 'PUMP_MAX_RUNTIME' })) === 1);
    t.deps.bus.emit('device.reported', {
      deviceId, ownerId: userId, reported: { ...reported, pumpReason: 'wet' }, at: new Date(T0 + MIN),
    });
    await waitFor(async () => (await Alert.countDocuments({ active: true })) === 0);
  });

  it('concurrent raises never create duplicates', async () => {
    const svc = t.deps.services.alerts;
    await Promise.all(
      Array.from({ length: 25 }, () =>
        svc.raise({ deviceId, ownerId: userId, type: 'SENSOR_FAULT', severity: 'critical', message: 'x', at: new Date() }),
      ),
    );
    const a = await Alert.find().lean();
    expect(a).toHaveLength(1);
    expect(a[0]!.count).toBe(25);
  });
});

describe('alert routes', () => {
  async function seedAlerts(n: number) {
    for (let i = 0; i < n; i++) {
      await Alert.create({
        deviceId, ownerId: userId, type: 'LOW_MOISTURE', severity: i % 2 ? 'critical' : 'warning',
        status: 'resolved', active: false, message: `a${i}`, count: 1,
        firstSeenAt: new Date(T0 + i * MIN), lastSeenAt: new Date(T0 + i * MIN),
      });
    }
  }

  it('paginates newest first with a stable cursor', async () => {
    await seedAlerts(7);
    const p1 = (await t.app.inject({ method: 'GET', url: '/v1/alerts?limit=3', headers })).json();
    expect(p1.items.map((a: { message: string }) => a.message)).toEqual(['a6', 'a5', 'a4']);
    expect(p1.items[0].deviceName).toMatch(/^Xeno [0-9]+$/);
    const p2 = (await t.app.inject({ method: 'GET', url: `/v1/alerts?limit=3&cursor=${p1.nextCursor}`, headers })).json();
    expect(p2.items.map((a: { message: string }) => a.message)).toEqual(['a3', 'a2', 'a1']);
    const p3 = (await t.app.inject({ method: 'GET', url: `/v1/alerts?limit=3&cursor=${p2.nextCursor}`, headers })).json();
    expect(p3.items).toHaveLength(1);
    expect(p3.nextCursor).toBeNull();
  });

  it('acknowledges, resolves, counts and filters', async () => {
    const svc = t.deps.services.alerts;
    const a = await svc.raise({ deviceId, ownerId: userId, type: 'SENSOR_FAULT', severity: 'critical', message: 'm', at: new Date() });
    expect((await t.app.inject({ method: 'GET', url: '/v1/alerts/counts', headers })).json()).toEqual({ open: 1, critical: 1 });

    const ack = await t.app.inject({ method: 'POST', url: `/v1/alerts/${a.id}/ack`, headers });
    expect(ack.json()).toMatchObject({ status: 'acknowledged' });
    expect((await t.app.inject({ method: 'GET', url: '/v1/alerts/counts', headers })).json()).toEqual({ open: 0, critical: 1 });

    const open = (await t.app.inject({ method: 'GET', url: '/v1/alerts?status=open,acknowledged', headers })).json();
    expect(open.items).toHaveLength(1);

    const res = await t.app.inject({ method: 'POST', url: `/v1/alerts/${a.id}/resolve`, headers });
    expect(res.json()).toMatchObject({ status: 'resolved' });
    expect((await t.app.inject({ method: 'GET', url: '/v1/alerts?status=open', headers })).json().items).toHaveLength(0);
  });

  it('hides other users alerts', async () => {
    const a = await t.deps.services.alerts.raise({
      deviceId, ownerId: userId, type: 'SENSOR_FAULT', severity: 'critical', message: 'm', at: new Date(),
    });
    const other = await t.signUp();
    expect((await t.app.inject({ method: 'POST', url: `/v1/alerts/${a.id}/ack`, headers: other.headers })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/v1/alerts', headers: other.headers })).json().items).toHaveLength(0);
  });
});
