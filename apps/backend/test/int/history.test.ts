import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Reading, ReadingHourly } from '../../src/db/models.js';
import { pickResolution } from '../../src/modules/telemetry/queries.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';

let t: TestApp;
let headers: { authorization: string };
let id: string;
const T0 = new Date('2026-05-01T00:00:00Z').getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;

beforeAll(async () => {
  await startMongo();
  t = await createTestApp({}, { now: () => new Date(T0 + 48 * HOUR) });
});
afterAll(async () => {
  await t.app.close();
  await stopMongo();
});
beforeEach(async () => {
  await clearDb();
  const u = await t.signUp();
  headers = u.headers;
  id = (
    await t.app.inject({
      method: 'POST',
      url: '/v1/devices/claim',
      headers,
      payload: { hardwareId: 'xg-aabbccddeeff', claimCode: 'ABCD2345' },
    })
  ).json().device.id;
});

/** One reading per minute for `hours` hours; moisture = minute index % 60, pump on in 2nd half-hour. */
async function seed(hours: number) {
  const docs = [];
  for (let m = 0; m < hours * 60; m++) {
    docs.push({
      ts: new Date(T0 + m * MIN),
      deviceId: new Types.ObjectId(id),
      soilMoisture: m % 60,
      soilRaw: 2000,
      temperature: 20 + (m % 2),
      humidity: m % 60 < 30 ? 50 : null,
      rain: false,
      pump: m % 60 >= 30,
    });
  }
  await Reading.insertMany(docs);
}

const get = (url: string) => t.app.inject({ method: 'GET', url, headers });
const iso = (ms: number) => new Date(ms).toISOString();

describe('resolution picking', () => {
  it('maps spans to resolutions', () => {
    const f = new Date(T0);
    expect(pickResolution(f, new Date(T0 + 6 * HOUR), 'auto')).toBe('raw');
    expect(pickResolution(f, new Date(T0 + 24 * HOUR), 'auto')).toBe('5m');
    expect(pickResolution(f, new Date(T0 + 7 * 24 * HOUR), 'auto')).toBe('1h');
    expect(pickResolution(f, new Date(T0 + 90 * 24 * HOUR), 'auto')).toBe('1d');
    expect(pickResolution(f, new Date(T0 + 90 * 24 * HOUR), 'raw')).toBe('raw');
  });
});

describe('GET /devices/:id/readings', () => {
  it('returns raw points for short ranges', async () => {
    await seed(2);
    const res = await get(`/v1/devices/${id}/readings?from=${iso(T0)}&to=${iso(T0 + 10 * MIN - 1)}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resolution).toBe('raw');
    expect(body.points).toHaveLength(10);
    expect(body.points[3]).toMatchObject({ ts: iso(T0 + 3 * MIN), soilMoisture: 3, rain: 0, pump: 0 });
    expect(body.stats.samples).toBe(10);
  });

  it('buckets into 5-minute averages for day ranges', async () => {
    await seed(2);
    const res = await get(`/v1/devices/${id}/readings?from=${iso(T0)}&to=${iso(T0 + 24 * HOUR)}`);
    const body = res.json();
    expect(body.resolution).toBe('5m');
    expect(body.points).toHaveLength(24); // 2 h of data
    expect(body.points[0]).toMatchObject({
      ts: iso(T0),
      soilMoisture: 2, // avg of 0..4
      soilMoistureMin: 0,
      soilMoistureMax: 4,
      temperature: 20.4,
      pump: 0,
    });
    expect(body.points[6].pump).toBe(1); // minutes 30..34
    expect(body.points[6].humidity).toBeNull(); // all null in that bucket
  });

  it('uses hourly rollups for week ranges, weighted correctly into days', async () => {
    await seed(3);
    await t.deps.services.readings.rollup(new Date(T0), new Date(T0 + 3 * HOUR));
    await t.deps.services.readings.rollup(new Date(T0), new Date(T0 + 3 * HOUR)); // idempotent
    expect(await ReadingHourly.countDocuments()).toBe(3);

    const week = await get(`/v1/devices/${id}/readings?from=${iso(T0)}&to=${iso(T0 + 7 * 24 * HOUR)}`);
    const wb = week.json();
    expect(wb.resolution).toBe('1h');
    expect(wb.points).toHaveLength(3);
    expect(wb.points[0]).toMatchObject({ soilMoisture: 29.5, soilMoistureMin: 0, soilMoistureMax: 59, pump: 0.5 });

    const days = await get(
      `/v1/devices/${id}/readings?from=${iso(T0)}&to=${iso(T0 + 7 * 24 * HOUR)}&resolution=1d&tz=Asia/Kolkata`,
    );
    const db = days.json();
    expect(db.resolution).toBe('1d');
    expect(db.points).toHaveLength(1);
    expect(db.points[0].soilMoisture).toBe(29.5);
    expect(db.points[0].humidity).toBe(50);
  });

  it('validates ranges and time zones', async () => {
    expect((await get(`/v1/devices/${id}/readings?from=${iso(T0 + HOUR)}&to=${iso(T0)}`)).statusCode).toBe(400);
    expect((await get(`/v1/devices/${id}/readings?from=${iso(T0)}&to=${iso(T0 + HOUR)}&tz=$bad`)).statusCode).toBe(400);
  });

  it('hides other users devices', async () => {
    const other = await t.signUp();
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/devices/${id}/readings?from=${iso(T0)}&to=${iso(T0 + HOUR)}`,
      headers: other.headers,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('pump events', () => {
  it('records sessions from reported transitions and sums pump time', async () => {
    const pe = t.deps.services.pumpEvents;
    await pe.onReported(id, true, 'dry', new Date(T0 + 10 * MIN));
    await pe.onReported(id, true, 'hold', new Date(T0 + 11 * MIN)); // still on: no new event
    await pe.onReported(id, false, 'wet', new Date(T0 + 15 * MIN));
    await pe.onReported(id, true, 'manual', new Date(T0 + 20 * MIN));
    await pe.onReported(id, false, 'max_runtime', new Date(T0 + 30 * MIN));
    await pe.onReported(id, false, 'wet', new Date(T0 + 31 * MIN)); // already off: no-op

    const res = await get(`/v1/devices/${id}/pump-events?from=${iso(T0)}&to=${iso(T0 + HOUR)}`);
    const items = res.json().items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ source: 'manual', reason: 'manual', stopReason: 'max_runtime', durationSec: 600 });
    expect(items[1]).toMatchObject({ source: 'auto', reason: 'dry', stopReason: 'wet', durationSec: 300 });

    const r = await get(`/v1/devices/${id}/readings?from=${iso(T0)}&to=${iso(T0 + HOUR)}`);
    expect(r.json().stats.pumpOnSec).toBe(900);
  });

  it('counts an open session up to now', async () => {
    await t.deps.services.pumpEvents.onReported(id, true, 'dry', new Date(T0 + 48 * HOUR - 120_000));
    const r = await get(`/v1/devices/${id}/readings?from=${iso(T0 + 47 * HOUR)}&to=${iso(T0 + 49 * HOUR)}`);
    expect(r.json().stats.pumpOnSec).toBe(120);
  });
});
