/**
 * The whole system at once: real runtime (HTTP + embedded MQTT + Socket.IO + Mongo) and a
 * simulated ESP32 that onboards through the public API exactly like the app + firmware would.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { runSimulation, signIn, type Simulation } from '@xeno/simulator';
import type { RtShadow, RtStatus, RtTelemetry } from '@xeno/shared';
import { startRuntime, type Runtime } from '../../src/runtime.js';
import { Alert, PumpEvent } from '../../src/db/models.js';
import { testEnv } from '../helpers/env.js';
import { startMongo, stopMongo } from '../helpers/mongo.js';
import { waitFor } from '../helpers/mqtt.js';

let rt: Runtime;
let sim: Simulation;
let token: string;
let deviceId: string;
let socket: Socket;
const telemetry: RtTelemetry[] = [];
const shadows: RtShadow[] = [];
const statuses: RtStatus[] = [];
const EMAIL = 'e2e@xeno.garden';
const PASSWORD = 'e2e-password-1';

const api = (method: string, url: string, payload?: object) =>
  rt.app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${token}` } });
const lastReported = () => [...shadows].reverse().find((s) => s.reported)?.reported;

beforeAll(async () => {
  await startMongo();
  rt = await startRuntime(
    testEnv({ PORT: '0', HOST: '127.0.0.1', MQTT_EMBEDDED_PORT: '0', ALERT_LOW_MOISTURE_MINUTES: '0' }),
    { skipDb: true },
  );
});

afterAll(async () => {
  socket?.disconnect();
  await sim?.stop();
  await rt.close();
  await stopMongo();
});

describe('end-to-end: onboarding → live data → control → alerts → offline', () => {
  it('a simulated device onboards through the public API and goes live', async () => {
    sim = await runSimulation({
      api: rt.url,
      email: EMAIL,
      password: PASSWORD,
      devices: 1,
      scenario: 'steady',
      mqttUrl: `mqtt://127.0.0.1:${rt.mqttPort}`,
      tickMs: 250,
    });
    deviceId = sim.deviceIds[0]!;
    token = await signIn(rt.url, EMAIL, PASSWORD);

    socket = ioClient(`${rt.url}/rt`, { auth: { token }, transports: ['websocket'] });
    socket.on('telemetry', (e: RtTelemetry) => telemetry.push(e));
    socket.on('shadow', (e: RtShadow) => shadows.push(e));
    socket.on('status', (e: RtStatus) => statuses.push(e));
    await new Promise<void>((r) => socket.on('connect', () => r()));
    const ack = await new Promise<{ ok: boolean }>((r) => socket.emit('subscribe', { deviceId }, r));
    expect(ack.ok).toBe(true);

    // the device applied its initial desired state (v1) and reports it
    await waitFor(async () => (await api('GET', `/v1/devices/${deviceId}`)).json().syncPending === false, 10_000);
    const d = (await api('GET', `/v1/devices/${deviceId}`)).json();
    expect(d).toMatchObject({ online: true, firmwareVersion: '2.0.0-sim', reported: { appliedVersion: 1 } });
  });

  it('streams telemetry to the app', async () => {
    await api('PUT', `/v1/devices/${deviceId}/settings`, { telemetryIntervalSec: 2 });
    await waitFor(() => telemetry.length >= 2, 10_000);
    expect(telemetry[0]).toMatchObject({ deviceId });
    expect(typeof telemetry[0]!.soilMoisture).toBe('number');
  });

  it('switches to manual mode and the device confirms', async () => {
    const res = await api('PUT', `/v1/devices/${deviceId}/mode`, { mode: 'manual' });
    expect(res.statusCode).toBe(200);
    const version = res.json().desired.version;
    await waitFor(() => lastReported()?.appliedVersion === version && lastReported()?.mode === 'manual', 10_000);
    expect(lastReported()?.pump).toBe(false);
  });

  it('manual pump ON runs, is acknowledged via reported state, and expires on the device', async () => {
    const res = await api('POST', `/v1/devices/${deviceId}/pump`, { action: 'ON', durationSec: 10 });
    expect(res.statusCode).toBe(200);
    const { cmdId } = res.json();
    await waitFor(() => lastReported()?.manualCmdId === cmdId && lastReported()?.pump === true, 10_000);
    await waitFor(async () => (await PumpEvent.countDocuments({ endedAt: null })) === 1, 5_000);

    // no further commands: the device switches itself off at expiry
    await waitFor(() => lastReported()?.pump === false, 20_000);
    await waitFor(async () => (await PumpEvent.countDocuments({ endedAt: { $ne: null } })) === 1, 5_000);
    const ev = await PumpEvent.findOne().lean();
    expect(ev?.source).toBe('manual');
    expect(ev?.durationSec).toBeGreaterThanOrEqual(9);
    expect(ev?.durationSec).toBeLessThanOrEqual(12);
    // the backend cleaned the finished command out of desired so a reboot won't replay it
    await waitFor(async () => (await api('GET', `/v1/devices/${deviceId}`)).json().desired.manual === null, 10_000);
  });

  it('a persistently dry garden produces exactly one deduplicated alert', async () => {
    // manual mode never waters; raising the threshold above the soil makes it "dry"
    await api('PUT', `/v1/devices/${deviceId}/settings`, { moistureLow: 80, moistureHigh: 90 });
    const before = telemetry.length;
    await waitFor(() => telemetry.length >= before + 4, 15_000);
    await waitFor(async () => (await Alert.countDocuments({ type: 'LOW_MOISTURE' })) === 1, 5_000);
    const alerts = (await api('GET', '/v1/alerts?status=open')).json();
    expect(alerts.items).toHaveLength(1);
    expect(alerts.items[0]).toMatchObject({ type: 'LOW_MOISTURE', count: 1, deviceName: 'Sim steady 1' });
  });

  it('history endpoint returns the recorded readings', async () => {
    const to = new Date(Date.now() + 1000).toISOString();
    const from = new Date(Date.now() - 10 * 60_000).toISOString();
    const res = await api('GET', `/v1/devices/${deviceId}/readings?from=${from}&to=${to}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().resolution).toBe('raw');
    expect(res.json().points.length).toBeGreaterThanOrEqual(telemetry.length - 2);
    expect(res.json().stats.pumpOnSec).toBeGreaterThanOrEqual(9);
  });

  it('power loss → LWT offline → DEVICE_OFFLINE alert after the grace period', async () => {
    sim.devices[0]!.powerCut(); // no DISCONNECT packet → LWT
    await waitFor(() => statuses.some((s) => s.deviceId === deviceId && !s.online), 30_000);
    expect((await api('GET', `/v1/devices/${deviceId}`)).json().online).toBe(false);
    await rt.deps.services.alertEngine.tick(new Date(Date.now() + 4 * 60_000));
    expect(await Alert.countDocuments({ type: 'DEVICE_OFFLINE', active: true })).toBe(1);
    // commands are refused while offline, with a clear error
    const res = await api('POST', `/v1/devices/${deviceId}/pump`, { action: 'ON' });
    expect(res.json().error.code).toBe('DEVICE_OFFLINE');
  });
});
