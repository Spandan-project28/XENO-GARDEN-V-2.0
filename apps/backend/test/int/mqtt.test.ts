import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, topicFor, type DesiredState } from '@xeno/shared';
import { startEmbeddedBroker, type EmbeddedBroker } from '../../src/mqtt/broker.js';
import { DeviceGateway, type InboundHandlers } from '../../src/mqtt/gateway.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';
import { connectDevice, silentLog, sleep, waitFor } from '../helpers/mqtt.js';

let t: TestApp;
let broker: EmbeddedBroker;
let gw: DeviceGateway;
const calls: { kind: string; hw: string; data: unknown }[] = [];
const connections: [string, boolean][] = [];

const HW = 'xg-aabbccddeeff';
const HW2 = 'xg-112233445566';

beforeAll(async () => {
  await startMongo();
  t = await createTestApp();
  broker = await startEmbeddedBroker({
    port: 0,
    host: '127.0.0.1',
    verifyDevice: t.deps.services.devices.verifyMqttCredentials,
    onDeviceConnection: (hw, c) => connections.push([hw, c]),
  });
  gw = new DeviceGateway({
    url: `mqtt://127.0.0.1:${broker.port}`,
    ...broker.serviceCredentials,
    log: silentLog,
  });
  const rec =
    (kind: string) =>
    async (hw: string, data: unknown) => {
      calls.push({ kind, hw, data });
    };
  const handlers: InboundHandlers = {
    telemetry: rec('telemetry'),
    reported: rec('reported'),
    status: rec('status'),
    event: rec('event'),
    cmdAck: rec('cmdAck'),
  };
  gw.setHandlers(handlers);
  await gw.start();
});

afterAll(async () => {
  await gw.close();
  await broker.close();
  await t.app.close();
  await stopMongo();
});

beforeEach(async () => {
  await clearDb();
  calls.length = 0;
  connections.length = 0;
});

async function claimDevice(hw: string) {
  const u = await t.signUp();
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    headers: u.headers,
    payload: { hardwareId: hw, claimCode: 'ABCD2345' },
  });
  return res.json().mqtt.password as string;
}

const telemetry = { soilMoisture: 41.5, soilRaw: 2100, temperature: 24.2, humidity: 55, rain: false, pump: false };

describe('embedded broker + gateway', () => {
  it('accepts a claimed device and routes validated telemetry', async () => {
    const pw = await claimDevice(HW);
    const dev = await connectDevice(broker.port, HW, pw);
    await waitFor(() => broker.connectedDevices() === 1);
    await dev.publishAsync(topicFor(HW, 'telemetry'), JSON.stringify(telemetry), { qos: 1 });
    await dev.publishAsync(topicFor(HW, 'telemetry'), JSON.stringify({ ...telemetry, soilMoisture: 999 }), { qos: 1 });
    await dev.publishAsync(topicFor(HW, 'telemetry'), 'not json', { qos: 1 });
    await dev.publishAsync(topicFor(HW, 'status'), 'online', { qos: 1, retain: true });
    await waitFor(() => calls.some((c) => c.kind === 'status'));
    await gw.idle();
    expect(calls.filter((c) => c.kind === 'telemetry')).toEqual([{ kind: 'telemetry', hw: HW, data: telemetry }]);
    expect(calls.find((c) => c.kind === 'status')?.data).toBe(true);
    await dev.endAsync();
    await waitFor(() => connections.some(([, c]) => c === false));
    expect(connections).toEqual([
      [HW, true],
      [HW, false],
    ]);
  });

  it('rejects wrong passwords, unknown devices and spoofed client ids', async () => {
    const pw = await claimDevice(HW);
    await expect(connectDevice(broker.port, HW, 'wrong')).rejects.toThrow();
    await expect(connectDevice(broker.port, HW2, pw)).rejects.toThrow();
    await expect(connectDevice(broker.port, HW, pw, { clientId: 'other' })).rejects.toThrow();
    expect(broker.connectedDevices()).toBe(0);
  });

  it('disconnects a device that publishes into another device subtree', async () => {
    const pw = await claimDevice(HW);
    const dev = await connectDevice(broker.port, HW, pw);
    const closed = new Promise<void>((r) => dev.once('close', () => r()));
    dev.publish(topicFor(HW2, 'telemetry'), JSON.stringify(telemetry), { qos: 1 });
    await closed;
    await sleep(50);
    expect(calls.filter((c) => c.hw === HW2)).toHaveLength(0);
    dev.end(true);
  });

  it('delivers retained desired state to the device, and only its own', async () => {
    const pw = await claimDevice(HW);
    const desired: DesiredState = { version: 7, mode: 'auto', settings: defaultSettings, manual: null };
    await gw.publishDesired(HW, desired);
    await gw.publishDesired(HW2, { ...desired, version: 99 });
    const dev = await connectDevice(broker.port, HW, pw);
    const got: string[] = [];
    dev.on('message', (topic, payload) => got.push(`${topic}:${payload.toString()}`));
    await dev.subscribeAsync(topicFor(HW, 'desired'), { qos: 1 });
    // another device's subtree is refused (SUBACK 128)
    await expect(dev.subscribeAsync(topicFor(HW2, 'desired'), { qos: 1 })).rejects.toThrow();
    await waitFor(() => got.length >= 1);
    await sleep(100);
    expect(got).toEqual([`${topicFor(HW, 'desired')}:${JSON.stringify(desired)}`]);
    await gw.clearDesired(HW);
    await gw.clearDesired(HW2);
    await dev.endAsync();
  });

  it('processes one device’s messages in order', async () => {
    const pw = await claimDevice(HW);
    const dev = await connectDevice(broker.port, HW, pw);
    for (let i = 0; i < 20; i++) {
      dev.publish(topicFor(HW, 'telemetry'), JSON.stringify({ ...telemetry, soilRaw: 1000 + i }), { qos: 1 });
    }
    await waitFor(() => calls.length === 20);
    await gw.idle();
    expect(calls.map((c) => (c.data as { soilRaw: number }).soilRaw)).toEqual(
      Array.from({ length: 20 }, (_, i) => 1000 + i),
    );
    await dev.endAsync();
  });

  it('publishes the LWT when a device drops', async () => {
    const pw = await claimDevice(HW);
    const dev = await connectDevice(broker.port, HW, pw);
    await waitFor(() => broker.connectedDevices() === 1);
    dev.stream.destroy(); // simulate power loss, no DISCONNECT packet
    await waitFor(() => calls.some((c) => c.kind === 'status' && c.data === false));
    dev.end(true);
  });
});
