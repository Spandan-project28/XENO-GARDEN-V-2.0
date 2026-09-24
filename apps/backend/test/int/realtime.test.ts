import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { topicFor, type RtServerToClient, type RtSubscribeAck } from '@xeno/shared';
import type { MqttClient } from 'mqtt';
import { startRuntime, type Runtime } from '../../src/runtime.js';
import { PumpEvent } from '../../src/db/models.js';
import { testEnv } from '../helpers/env.js';
import { startMongo, stopMongo } from '../helpers/mongo.js';
import { connectDevice, waitFor } from '../helpers/mqtt.js';

let rt: Runtime;
const HW = 'xg-aabbccddeeff';
const sockets: Socket[] = [];

beforeAll(async () => {
  await startMongo();
  rt = await startRuntime(
    testEnv({ PORT: '0', HOST: '127.0.0.1', MQTT_EMBEDDED: 'true', MQTT_EMBEDDED_PORT: '0' }),
    { skipDb: true },
  );
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await rt.close();
  await stopMongo();
});

async function signUp(email: string) {
  const res = await rt.app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, password: 'long-password-1', name: 'U' },
  });
  return res.json() as { accessToken: string; user: { id: string } };
}

function connectSocket(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`${rt.url}/rt`, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function collect(s: Socket) {
  const got: { event: keyof RtServerToClient; data: unknown }[] = [];
  for (const event of ['telemetry', 'shadow', 'status', 'device_event', 'cmd_ack', 'alert', 'device_removed'] as const) {
    s.on(event as string, (data: unknown) => got.push({ event, data }));
  }
  return got;
}

const subscribe = (s: Socket, deviceId: string) =>
  new Promise<RtSubscribeAck>((resolve) => s.emit('subscribe', { deviceId }, resolve));

describe('realtime end-to-end through the runtime', () => {
  let owner: { accessToken: string; user: { id: string } };
  let deviceId: string;
  let mqttPassword: string;
  let dev: MqttClient;
  let sock: Socket;
  let events: ReturnType<typeof collect>;

  it('rejects sockets without a valid token', async () => {
    await expect(connectSocket('garbage')).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('health reports MQTT connected', async () => {
    const res = await rt.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.json().checks).toEqual({ db: true, mqtt: true });
  });

  it('streams telemetry and status for subscribed devices', async () => {
    owner = await signUp('owner@example.com');
    const claim = await rt.app.inject({
      method: 'POST',
      url: '/v1/devices/claim',
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { hardwareId: HW, claimCode: 'ABCD2345' },
    });
    deviceId = claim.json().device.id;
    mqttPassword = claim.json().mqtt.password;

    sock = await connectSocket(owner.accessToken);
    events = collect(sock);
    const ack = await subscribe(sock, deviceId);
    expect(ack).toMatchObject({ ok: true, device: { id: deviceId } });

    dev = await connectDevice(rt.mqttPort!, HW, mqttPassword);
    // the device receives its retained desired state on subscribe
    const desiredMsgs: string[] = [];
    dev.on('message', (_t, p) => desiredMsgs.push(p.toString()));
    await dev.subscribeAsync(topicFor(HW, 'desired'), { qos: 1 });
    await waitFor(() => desiredMsgs.length > 0);
    expect(JSON.parse(desiredMsgs[0]!).version).toBe(1);

    await dev.publishAsync(topicFor(HW, 'status'), 'online', { qos: 1, retain: true });
    await dev.publishAsync(
      topicFor(HW, 'telemetry'),
      JSON.stringify({ soilMoisture: 22, soilRaw: 2600, temperature: 30, humidity: 40, rain: false, pump: false }),
      { qos: 1 },
    );
    await waitFor(() => events.some((e) => e.event === 'telemetry'));
    expect(events.find((e) => e.event === 'telemetry')?.data).toMatchObject({ deviceId, soilMoisture: 22 });
    expect(events.find((e) => e.event === 'status')?.data).toMatchObject({ deviceId, online: true });
    expect(rt.deps.status.devicesConnected()).toBe(1);
    expect(rt.deps.metrics.mqttMessages.get({ kind: 'telemetry' })).toBeGreaterThanOrEqual(1);
  });

  it('pushes desired changes and reported state; records pump sessions', async () => {
    const res = await rt.app.inject({
      method: 'POST',
      url: `/v1/devices/${deviceId}/pump`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { action: 'ON', durationSec: 60 },
    });
    expect(res.statusCode).toBe(200);
    const { cmdId } = res.json();
    await waitFor(() => events.some((e) => e.event === 'shadow' && (e.data as { desired?: unknown }).desired));

    const reported = {
      appliedVersion: 2, mode: 'auto', pump: true, pumpReason: 'manual', manualCmdId: cmdId,
      manualRemainingSec: 60, cooldownRemainingSec: null, fwVersion: '2.0.0', rssi: -60,
      ssid: 'Home', ip: '192.0.2.4', uptimeSec: 10, heapFree: 100000, soilCalibrated: true,
    };
    await dev.publishAsync(topicFor(HW, 'reported'), JSON.stringify(reported), { qos: 1, retain: true });
    await waitFor(() => events.some((e) => e.event === 'shadow' && (e.data as { reported?: unknown }).reported));
    await waitFor(async () => (await PumpEvent.countDocuments({ endedAt: null })) === 1);

    await dev.publishAsync(topicFor(HW, 'cmdAck'), JSON.stringify({ cmdId: 'x1', ok: true }), { qos: 1 });
    await waitFor(() => events.some((e) => e.event === 'cmd_ack'));
  });

  it('does not leak other users devices', async () => {
    const stranger = await signUp('stranger@example.com');
    const s2 = await connectSocket(stranger.accessToken);
    const got = collect(s2);
    expect(await subscribe(s2, deviceId)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await subscribe(s2, 'nope')).toEqual({ ok: false, error: 'BAD_REQUEST' });
    await dev.publishAsync(
      topicFor(HW, 'telemetry'),
      JSON.stringify({ soilMoisture: 23, soilRaw: 2600, temperature: 30, humidity: 40, rain: false, pump: true }),
      { qos: 1 },
    );
    await waitFor(() => events.filter((e) => e.event === 'telemetry').length === 2);
    expect(got).toHaveLength(0);
  });

  it('marks offline via LWT and kicks the device when removed', async () => {
    const closed = new Promise<void>((r) => dev.once('close', () => r()));
    const del = await rt.app.inject({
      method: 'DELETE',
      url: `/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(del.statusCode).toBe(200);
    await waitFor(() => events.some((e) => e.event === 'device_removed'));
    await closed;
    dev.end(true);
    await waitFor(() => rt.deps.status.devicesConnected() === 0);
  });
});
