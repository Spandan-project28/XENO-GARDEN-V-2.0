import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReportedState } from '@xeno/shared';
import { Device } from '../../src/db/models.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { FakePublisher } from '../helpers/fakes.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';

let t: TestApp;
let clock = new Date('2026-05-01T10:00:00Z').getTime();
const pub = new FakePublisher();
const HW = 'xg-aabbccddeeff';
let headers: { authorization: string };
let id: string;

beforeAll(async () => {
  await startMongo();
  t = await createTestApp({}, { now: () => new Date(clock) });
  t.deps.publisher.attach(pub);
});
afterAll(async () => {
  await t.app.close();
  await stopMongo();
});
beforeEach(async () => {
  await clearDb();
  pub.reset();
  const u = await t.signUp();
  headers = u.headers;
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    headers,
    payload: { hardwareId: HW, claimCode: 'ABCD2345' },
  });
  id = res.json().device.id;
});

const put = (url: string, payload: object) => t.app.inject({ method: 'PUT', url, headers, payload });
const post = (url: string, payload: object) => t.app.inject({ method: 'POST', url, headers, payload });
const goOnline = () => t.deps.services.ingest.status(HW, true, new Date(clock));

const reported = (over: Partial<ReportedState> = {}): ReportedState => ({
  appliedVersion: 1,
  mode: 'auto',
  pump: false,
  pumpReason: 'wet',
  manualCmdId: null,
  manualRemainingSec: null,
  cooldownRemainingSec: null,
  fwVersion: '2.0.0',
  rssi: -55,
  ssid: 'Home',
  ip: '192.0.2.10',
  uptimeSec: 42,
  heapFree: 150000,
  soilCalibrated: true,
  ...over,
});

describe('settings', () => {
  it('merges a patch, bumps version, publishes retained desired', async () => {
    const res = await put(`/v1/devices/${id}/settings`, { moistureLow: 25, maxPumpRunSec: 900 });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.desired.version).toBe(2);
    expect(d.desired.settings).toMatchObject({ moistureLow: 25, moistureHigh: 45, maxPumpRunSec: 900 });
    expect(d.syncPending).toBe(true);
    expect(pub.desired).toHaveLength(1);
    expect(pub.lastDesired()?.version).toBe(2);
  });

  it('validates the merged result (hysteresis gap)', async () => {
    const res = await put(`/v1/devices/${id}/settings`, { moistureLow: 43 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(res.json().error.message).toMatch(/at least 5%/);
    expect(pub.desired).toHaveLength(0);
  });

  it('never loses concurrent updates', async () => {
    const values = [300, 310, 320, 330, 340, 350, 360, 370];
    const results = await Promise.all(values.map((v) => put(`/v1/devices/${id}/settings`, { maxPumpRunSec: v })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const d = await Device.findById(id).lean();
    expect(d?.desired.version).toBe(1 + values.length);
    expect(new Set(pub.desired.map((p) => p.desired.version)).size).toBe(values.length);
  });
});

describe('mode', () => {
  it('switches mode and cancels a manual command', async () => {
    await goOnline();
    await post(`/v1/devices/${id}/pump`, { action: 'ON' });
    const res = await put(`/v1/devices/${id}/mode`, { mode: 'manual' });
    expect(res.json().desired).toMatchObject({ mode: 'manual', manual: null, version: 3 });
  });
});

describe('pump', () => {
  it('refuses commands while the device is offline', async () => {
    const res = await post(`/v1/devices/${id}/pump`, { action: 'ON' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DEVICE_OFFLINE');
  });

  it('ON is capped at maxPumpRunSec and carries an expiry', async () => {
    await goOnline();
    const res = await post(`/v1/devices/${id}/pump`, { action: 'ON', durationSec: 1200 });
    expect(res.statusCode).toBe(200);
    const { cmdId, device } = res.json();
    expect(device.desired.manual).toEqual({
      cmdId,
      pump: 'ON',
      durationSec: 600,
      issuedAt: clock,
      expiresAt: clock + 600_000,
    });
    expect(pub.lastDesired()?.manual?.cmdId).toBe(cmdId);
  });

  it('OFF in auto mode pauses automation (default 30 min)', async () => {
    await goOnline();
    const res = await post(`/v1/devices/${id}/pump`, { action: 'OFF' });
    expect(res.json().device.desired.manual).toMatchObject({ pump: 'OFF', durationSec: 1800 });
  });

  it('OFF in manual mode simply clears the command', async () => {
    await goOnline();
    await put(`/v1/devices/${id}/mode`, { mode: 'manual' });
    await post(`/v1/devices/${id}/pump`, { action: 'ON' });
    const res = await post(`/v1/devices/${id}/pump`, { action: 'OFF' });
    expect(res.json().device.desired.manual).toBeNull();
  });

  it('rejects durations outside limits', async () => {
    await goOnline();
    expect((await post(`/v1/devices/${id}/pump`, { action: 'ON', durationSec: 5 })).statusCode).toBe(400);
    expect((await post(`/v1/devices/${id}/pump`, { action: 'ON', durationSec: 99999 })).statusCode).toBe(400);
  });
});

describe('reported', () => {
  it('stores reported state and clears syncPending once applied', async () => {
    await t.deps.services.control.onReported(HW, reported({ appliedVersion: 1 }), new Date(clock));
    const res = await t.app.inject({ method: 'GET', url: `/v1/devices/${id}`, headers });
    expect(res.json()).toMatchObject({
      syncPending: false,
      firmwareVersion: '2.0.0',
      reported: { pumpReason: 'wet', ssid: 'Home', at: new Date(clock).toISOString() },
    });
  });

  it('clears a manual command the device dropped on its own', async () => {
    await goOnline();
    const { device } = (await post(`/v1/devices/${id}/pump`, { action: 'ON' })).json();
    expect(device.desired.version).toBe(2);
    pub.reset();
    // device applied v2 but reports no active manual command (e.g. max runtime hit)
    await t.deps.services.control.onReported(
      HW,
      reported({ appliedVersion: 2, pumpReason: 'max_runtime', manualCmdId: null }),
      new Date(clock),
    );
    const d = await Device.findById(id).lean();
    expect(d?.desired.manual).toBeNull();
    expect(d?.desired.version).toBe(3);
    expect(pub.lastDesired()?.manual).toBeNull();
  });

  it('keeps a manual command the device is still running', async () => {
    await goOnline();
    const { cmdId } = (await post(`/v1/devices/${id}/pump`, { action: 'ON' })).json();
    await t.deps.services.control.onReported(
      HW,
      reported({ appliedVersion: 2, pump: true, pumpReason: 'manual', manualCmdId: cmdId }),
      new Date(clock),
    );
    expect((await Device.findById(id).lean())?.desired.manual?.cmdId).toBe(cmdId);
  });
});

describe('commands & republish', () => {
  it('sends one-shot commands to online devices', async () => {
    await goOnline();
    const res = await post(`/v1/devices/${id}/commands`, { type: 'identify' });
    expect(res.statusCode).toBe(200);
    expect(pub.commands[0]).toMatchObject({ hw: HW, cmd: { type: 'identify', cmdId: res.json().cmdId } });
  });

  it('republishes every desired state', async () => {
    expect(await t.deps.services.control.republishAll()).toBe(1);
    expect(pub.desired[0]?.hw).toBe(HW);
  });

  it('keeps working (and stores state) when MQTT is down', async () => {
    t.deps.publisher.attach(null);
    const res = await put(`/v1/devices/${id}/settings`, { moistureHigh: 60 });
    t.deps.publisher.attach(pub);
    expect(res.statusCode).toBe(200);
    expect((await Device.findById(id).lean())?.desired.settings.moistureHigh).toBe(60);
  });
});

clock += 0; // keep `let` (clock may be advanced by future tests)
