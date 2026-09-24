import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@xeno/shared';
import { Device, Plant } from '../../src/db/models.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';

let t: TestApp;
const HW = 'xg-3c71bf12ab34';
const CODE = 'ABCD2345';

beforeAll(async () => {
  await startMongo();
  t = await createTestApp({ DEVICE_BROKER_HOST: 'mqtt.example.test', DEVICE_BROKER_PORT: '8883', DEVICE_BROKER_TLS: 'true' });
});
afterAll(async () => {
  await t.app.close();
  await stopMongo();
});
beforeEach(clearDb);

const claim = (headers: Record<string, string>, body: object) =>
  t.app.inject({ method: 'POST', url: '/v1/devices/claim', headers, payload: body });

describe('devices', () => {
  it('claims a new device with defaults and returns broker credentials', async () => {
    const u = await t.signUp();
    const res = await claim(u.headers, { hardwareId: HW.toUpperCase(), claimCode: CODE.toLowerCase() });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.device).toMatchObject({
      hardwareId: HW,
      name: 'Garden AB34',
      online: false,
      syncPending: true,
      desired: { version: 1, mode: 'auto', settings: DEFAULT_SETTINGS, manual: null },
      reported: null,
    });
    expect(body.mqtt).toMatchObject({ host: 'mqtt.example.test', port: 8883, tls: true, username: HW });
    expect(body.mqtt.password.length).toBeGreaterThanOrEqual(24);
    const stored = await Device.findOne({ hardwareId: HW });
    expect(stored?.mqttPasswordHash).not.toContain(body.mqtt.password);
    expect(await t.deps.services.devices.verifyMqttCredentials(HW, body.mqtt.password)).toBe(true);
    expect(await t.deps.services.devices.verifyMqttCredentials(HW, 'nope')).toBe(false);
  });

  it('re-claim by the owner rotates the MQTT password', async () => {
    const u = await t.signUp();
    const first = (await claim(u.headers, { hardwareId: HW, claimCode: CODE })).json();
    const second = await claim(u.headers, { hardwareId: HW, claimCode: CODE, name: 'Balcony' });
    expect(second.statusCode).toBe(201);
    expect(second.json().device.name).toBe('Balcony');
    expect(second.json().device.id).toBe(first.device.id);
    const svc = t.deps.services.devices;
    expect(await svc.verifyMqttCredentials(HW, first.mqtt.password)).toBe(false);
    expect(await svc.verifyMqttCredentials(HW, second.json().mqtt.password)).toBe(true);
  });

  it('another user cannot claim without the claim code', async () => {
    const owner = await t.signUp();
    const other = await t.signUp();
    await claim(owner.headers, { hardwareId: HW, claimCode: CODE });
    const res = await claim(other.headers, { hardwareId: HW, claimCode: 'ZZZZ2345' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DEVICE_ALREADY_CLAIMED');
  });

  it('another user with the claim code (physical access) takes ownership', async () => {
    const owner = await t.signUp();
    const other = await t.signUp();
    await claim(owner.headers, { hardwareId: HW, claimCode: CODE, name: 'Old' });
    const removed: string[] = [];
    const off = t.deps.bus.on('device.removed', (e) => void removed.push(e.ownerId));
    const res = await claim(other.headers, { hardwareId: HW, claimCode: CODE });
    off();
    expect(res.statusCode).toBe(201);
    expect(res.json().device.name).toBe('Garden AB34');
    expect(removed).toEqual([owner.userId]);
    const list = await t.app.inject({ method: 'GET', url: '/v1/devices', headers: owner.headers });
    expect(list.json().items).toHaveLength(0);
  });

  it('lists, gets, renames and deletes only own devices', async () => {
    const u = await t.signUp();
    const stranger = await t.signUp();
    const id = (await claim(u.headers, { hardwareId: HW, claimCode: CODE })).json().device.id;

    const list = await t.app.inject({ method: 'GET', url: '/v1/devices', headers: u.headers });
    expect(list.json().items.map((d: { id: string }) => d.id)).toEqual([id]);

    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await t.app.inject({
        method,
        url: `/v1/devices/${id}`,
        headers: stranger.headers,
        ...(method === 'PATCH' ? { payload: { name: 'x' } } : {}),
      });
      expect(res.statusCode, method).toBe(404);
    }

    const renamed = await t.app.inject({
      method: 'PATCH',
      url: `/v1/devices/${id}`,
      headers: u.headers,
      payload: { name: '  Tomatoes  ' },
    });
    expect(renamed.json().name).toBe('Tomatoes');

    const del = await t.app.inject({ method: 'DELETE', url: `/v1/devices/${id}`, headers: u.headers });
    expect(del.statusCode).toBe(200);
    expect(await Device.countDocuments()).toBe(0);
  });

  it('attaches only own plants', async () => {
    const u = await t.signUp();
    const other = await t.signUp();
    const id = (await claim(u.headers, { hardwareId: HW, claimCode: CODE })).json().device.id;
    const foreignPlant = await Plant.create({ ownerId: other.userId, name: 'Not yours' });
    const ownPlant = await Plant.create({ ownerId: u.userId, name: 'Basil' });
    const bad = await t.app.inject({
      method: 'PATCH',
      url: `/v1/devices/${id}`,
      headers: u.headers,
      payload: { plantId: foreignPlant._id.toHexString() },
    });
    expect(bad.statusCode).toBe(404);
    const ok = await t.app.inject({
      method: 'PATCH',
      url: `/v1/devices/${id}`,
      headers: u.headers,
      payload: { plantId: ownPlant._id.toHexString() },
    });
    expect(ok.json().plantId).toBe(ownPlant._id.toHexString());
  });

  it('rejects malformed ids and hardware ids', async () => {
    const u = await t.signUp();
    expect((await t.app.inject({ method: 'GET', url: '/v1/devices/xyz', headers: u.headers })).statusCode).toBe(400);
    expect((await claim(u.headers, { hardwareId: 'esp32-field-01', claimCode: CODE })).statusCode).toBe(400);
  });

  it('requires auth', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/devices' })).statusCode).toBe(401);
  });
});
