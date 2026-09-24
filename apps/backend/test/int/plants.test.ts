import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Alert, Device, HealthReport, Reading } from '../../src/db/models.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';

let t: TestApp;
let headers: { authorization: string };
let deviceId: string;
const NOW = Date.parse('2026-05-08T00:00:00Z');
const H = 3_600_000;

beforeAll(async () => {
  await startMongo();
  t = await createTestApp({}, { now: () => new Date(NOW) });
});
afterAll(async () => {
  await t.app.close();
  await stopMongo();
});
beforeEach(async () => {
  await clearDb();
  const u = await t.signUp();
  headers = u.headers;
  deviceId = (
    await t.app.inject({ method: 'POST', url: '/v1/devices/claim', headers, payload: { hardwareId: 'xg-aabbccddeeff', claimCode: 'ABCD2345' } })
  ).json().device.id;
});

const api = (method: string, url: string, payload?: object, h = headers) =>
  t.app.inject({ method: method as 'GET', url, headers: h, payload });

async function seedWeek(soil: (h: number) => number) {
  const docs = [];
  for (let h = 0; h < 7 * 24; h++) {
    for (let m = 0; m < 60; m += 20) {
      docs.push({ ts: new Date(NOW - 7 * 24 * H + h * H + m * 60_000), deviceId: new Types.ObjectId(deviceId), soilMoisture: soil(h), soilRaw: 2000, temperature: 24, humidity: 50, rain: false, pump: false });
    }
  }
  await Reading.insertMany(docs);
}

describe('plants', () => {
  it('CRUD with ownership, linking and unlinking devices', async () => {
    const created = await api('POST', '/v1/plants', { name: 'Tomatoes', species: 'Tomato' });
    expect(created.statusCode).toBe(201);
    const plant = created.json();
    await api('PATCH', `/v1/devices/${deviceId}`, { plantId: plant.id });

    const list = await api('GET', '/v1/plants');
    expect(list.json().items).toEqual([expect.objectContaining({ name: 'Tomatoes', deviceId })]);

    const renamed = await api('PATCH', `/v1/plants/${plant.id}`, { notes: 'South balcony' });
    expect(renamed.json()).toMatchObject({ name: 'Tomatoes', notes: 'South balcony' });

    const other = await t.signUp();
    expect((await api('GET', `/v1/plants/${plant.id}/health`, undefined, other.headers)).statusCode).toBe(404);

    expect((await api('DELETE', `/v1/plants/${plant.id}`)).statusCode).toBe(200);
    expect((await Device.findById(deviceId).lean())?.plantId).toBeNull();
  });

  it('runs a health check from the last week of readings and keeps history', async () => {
    const plant = (await api('POST', '/v1/plants', { name: 'Basil' })).json();
    await api('PATCH', `/v1/devices/${deviceId}`, { plantId: plant.id });
    await seedWeek(() => 40);

    const empty = await api('GET', `/v1/plants/${plant.id}/health`);
    expect(empty.json()).toEqual({ latest: null, history: [] });

    const run = await api('POST', `/v1/plants/${plant.id}/health/run`);
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({ provider: 'rules', status: 'healthy', score: 100, deviceId });

    await api('POST', `/v1/plants/${plant.id}/health/run`);
    const h = (await api('GET', `/v1/plants/${plant.id}/health`)).json();
    expect(h.history).toHaveLength(2);
    expect(h.latest.findings[0].code).toBe('moisture_on_target');
  });

  it('raises a PLANT_HEALTH alert when a check is critical', async () => {
    const plant = (await api('POST', '/v1/plants', { name: 'Fern' })).json();
    await api('PATCH', `/v1/devices/${deviceId}`, { plantId: plant.id });
    await seedWeek((h) => (h < 60 ? 10 : 40));
    const run = await api('POST', `/v1/plants/${plant.id}/health/run`);
    expect(run.json().status).toBe('critical');
    expect(await Alert.countDocuments({ type: 'PLANT_HEALTH', active: true })).toBe(1);
  });

  it('the daily job evaluates linked plants once per day', async () => {
    const plant = (await api('POST', '/v1/plants', { name: 'Mint' })).json();
    await api('PATCH', `/v1/devices/${deviceId}`, { plantId: plant.id });
    await seedWeek(() => 42);
    expect(await t.deps.services.insights.runDue()).toBe(1);
    expect(await t.deps.services.insights.runDue()).toBe(0);
    expect(await HealthReport.countDocuments()).toBe(1);
  });
});
