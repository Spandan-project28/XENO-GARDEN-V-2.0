import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BusEvents } from '../../src/lib/bus.js';
import { AppBus } from '../../src/lib/bus.js';
import { Device, Reading } from '../../src/db/models.js';
import { createTelemetryIngest } from '../../src/modules/telemetry/ingest.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';
import { silentLog } from '../helpers/mqtt.js';

let t: TestApp;
let bus: AppBus;
let events: { name: keyof BusEvents; data: unknown }[];
const HW = 'xg-aabbccddeeff';
const payload = { soilMoisture: 33.3, soilRaw: 2222, temperature: 25, humidity: 60, rain: false, pump: true };

beforeAll(async () => {
  await startMongo();
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
  await stopMongo();
});
beforeEach(async () => {
  await clearDb();
  bus = new AppBus((err) => {
    throw err;
  });
  events = [];
  for (const name of ['device.telemetry', 'device.status', 'device.event'] as const) {
    bus.on(name, (data) => void events.push({ name, data }));
  }
  const u = await t.signUp();
  await t.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    headers: u.headers,
    payload: { hardwareId: HW, claimCode: 'ABCD2345' },
  });
});

describe('telemetry ingest', () => {
  it('stores a reading, updates latest, marks online once', async () => {
    const ingest = createTelemetryIngest({ bus, log: silentLog });
    const at = new Date('2026-05-01T10:00:00Z');
    await ingest.telemetry(HW, payload, at);
    await ingest.telemetry(HW, { ...payload, soilMoisture: 30 }, new Date(at.getTime() + 5000));

    expect(await Reading.countDocuments()).toBe(2);
    const d = await Device.findOne({ hardwareId: HW }).lean();
    expect(d?.online).toBe(true);
    expect(d?.lastSeenAt?.toISOString()).toBe('2026-05-01T10:00:05.000Z');
    expect(d?.latest).toMatchObject({ soilMoisture: 30, pump: true });
    expect(events.filter((e) => e.name === 'device.status')).toHaveLength(1);
    expect(events.filter((e) => e.name === 'device.telemetry')).toHaveLength(2);
  });

  it('trusts device timestamps only within the skew window', async () => {
    const ingest = createTelemetryIngest({ bus, log: silentLog });
    const at = new Date('2026-05-01T10:00:00Z');
    await ingest.telemetry(HW, { ...payload, ts: at.getTime() - 3000 }, at);
    await ingest.telemetry(HW, { ...payload, ts: 1000 }, at); // device clock not set
    const ts = (await Reading.find().sort({ ts: 1 }).lean()).map((r) => r.ts.toISOString());
    expect(ts).toEqual(['2026-05-01T09:59:57.000Z', '2026-05-01T10:00:00.000Z']);
  });

  it('ignores unclaimed devices', async () => {
    const ingest = createTelemetryIngest({ bus, log: silentLog });
    await ingest.telemetry('xg-000000000000', payload, new Date());
    expect(await Reading.countDocuments()).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('LWT offline flips status and emits once', async () => {
    const ingest = createTelemetryIngest({ bus, log: silentLog });
    await ingest.status(HW, true, new Date());
    await ingest.status(HW, false, new Date());
    await ingest.status(HW, false, new Date());
    expect((await Device.findOne({ hardwareId: HW }).lean())?.online).toBe(false);
    expect(events.map((e) => (e.data as { online: boolean }).online)).toEqual([true, false]);
  });

  it('sweeps devices that went silent', async () => {
    const ingest = createTelemetryIngest({ bus, log: silentLog });
    const at = new Date('2026-05-01T10:00:00Z');
    await ingest.telemetry(HW, payload, at);
    expect(await ingest.sweepStale(new Date(at.getTime() + 20_000), () => 30_000)).toBe(0);
    expect(await ingest.sweepStale(new Date(at.getTime() + 31_000), () => 30_000)).toBe(1);
    expect((await Device.findOne({ hardwareId: HW }).lean())?.online).toBe(false);
  });

  it('forwards device events', async () => {
    const ingest = createTelemetryIngest({ bus, log: silentLog });
    await ingest.event(HW, { type: 'sensor_fault', data: { sensor: 'soil' } }, new Date());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: 'device.event', data: { event: { type: 'sensor_fault' } } });
  });
});
