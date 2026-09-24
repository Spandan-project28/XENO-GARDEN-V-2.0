import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commandPayload } from '@xeno/shared';
import { Device } from '../../src/db/models.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { FakePublisher } from '../helpers/fakes.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';

const RELEASE = {
  FIRMWARE_LATEST_VERSION: '2.1.0',
  FIRMWARE_LATEST_URL: 'https://releases.example.com/xg/2.1.0/firmware.bin',
  FIRMWARE_LATEST_SHA256: 'ab'.repeat(32),
};
const HW = 'xg-aabbccddeeff';
let withRelease: TestApp;
let noRelease: TestApp;
const pub = new FakePublisher();

beforeAll(async () => {
  await startMongo();
  withRelease = await createTestApp(RELEASE);
  noRelease = await createTestApp();
  withRelease.deps.publisher.attach(pub);
  noRelease.deps.publisher.attach(pub);
});
afterAll(async () => {
  await withRelease.app.close();
  await noRelease.app.close();
  await stopMongo();
});
beforeEach(async () => {
  await clearDb();
  pub.reset();
});

async function setup(t: TestApp, fw: string | null, online: boolean) {
  const u = await t.signUp();
  const id = (
    await t.app.inject({ method: 'POST', url: '/v1/devices/claim', headers: u.headers, payload: { hardwareId: HW, claimCode: 'ABCD2345' } })
  ).json().device.id;
  await Device.updateOne({ _id: id }, { $set: { firmwareVersion: fw, online } });
  return { headers: u.headers, id };
}

describe('firmware updates (OTA)', () => {
  it('reports status and sends a verified OTA command to online devices', async () => {
    const { headers, id } = await setup(withRelease, '2.0.0', true);
    const status = await withRelease.app.inject({ method: 'GET', url: `/v1/devices/${id}/firmware`, headers });
    expect(status.json()).toEqual({ current: '2.0.0', latest: '2.1.0', updateAvailable: true });

    const res = await withRelease.app.inject({ method: 'POST', url: `/v1/devices/${id}/firmware/update`, headers });
    expect(res.statusCode).toBe(200);
    const cmd = pub.commands[0]!.cmd;
    expect(cmd).toMatchObject({ type: 'ota', url: RELEASE.FIRMWARE_LATEST_URL, sha256: RELEASE.FIRMWARE_LATEST_SHA256, version: '2.1.0' });
    expect(commandPayload.safeParse(cmd).success).toBe(true);
  });

  it('refuses when offline, already current, or no release is configured', async () => {
    const off = await setup(withRelease, '2.0.0', false);
    const r1 = await withRelease.app.inject({ method: 'POST', url: `/v1/devices/${off.id}/firmware/update`, headers: off.headers });
    expect(r1.json().error.code).toBe('DEVICE_OFFLINE');

    await clearDb();
    const cur = await setup(withRelease, '2.1.0', true);
    const r2 = await withRelease.app.inject({ method: 'POST', url: `/v1/devices/${cur.id}/firmware/update`, headers: cur.headers });
    expect(r2.statusCode).toBe(409);

    await clearDb();
    const none = await setup(noRelease, '2.0.0', true);
    const r3 = await noRelease.app.inject({ method: 'POST', url: `/v1/devices/${none.id}/firmware/update`, headers: none.headers });
    expect(r3.statusCode).toBe(404);
    const s = await noRelease.app.inject({ method: 'GET', url: `/v1/devices/${none.id}/firmware`, headers: none.headers });
    expect(s.json()).toEqual({ current: '2.0.0', latest: null, updateAvailable: false });
    expect(pub.commands).toHaveLength(0);
  });

  it('never lets clients send raw OTA commands with their own URL', async () => {
    const { headers, id } = await setup(withRelease, '2.0.0', true);
    const res = await withRelease.app.inject({
      method: 'POST',
      url: `/v1/devices/${id}/commands`,
      headers,
      payload: { type: 'ota', url: 'https://evil.example/fw.bin' },
    });
    expect(res.statusCode).toBe(400);
    expect(pub.commands).toHaveLength(0);
  });
});
