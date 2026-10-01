import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startBridge, type Bridge } from '../src/bridge.js';
import type { SimTransport } from '../src/device.js';

class FakeTransport implements SimTransport {
  connected = false;
  sent: string[] = [];
  private onConn: (c: boolean) => void = () => {};
  constructor(
    readonly url: string,
    readonly user: string,
  ) {}
  async connect() {
    this.connected = true;
    this.onConn(true);
  }
  publish(topic: string) {
    this.sent.push(topic);
  }
  onMessage() {}
  onConnectionChange(h: (c: boolean) => void) {
    this.onConn = h;
  }
  async subscribe() {}
  isConnected() {
    return this.connected;
  }
  drop() {}
  async end() {
    this.connected = false;
  }
}

const transports: FakeTransport[] = [];
let bridge: Bridge | null = null;

async function start(stateFile?: string) {
  bridge = await startBridge({
    port: 0,
    host: '127.0.0.1',
    stateFile,
    transportFactory: (url, c) => {
      const t = new FakeTransport(url, c.u);
      transports.push(t);
      return t;
    },
  });
  return bridge;
}

const body = (hwId = 'xg-de0000000001', u = hwId) => ({
  hwId,
  ssid: 'Home WiFi',
  cloud: { h: 'broker.local', p: 1883, t: false, u, pw: 'p'.repeat(32) },
});

const post = (b: Bridge, payload: unknown) =>
  fetch(`${b.url}/v1/sim/provision`, { method: 'POST', body: JSON.stringify(payload) });

afterEach(async () => {
  await bridge?.stop();
  bridge = null;
  transports.length = 0;
});

describe('virtual radio bridge', () => {
  it('turns a demo device set up in the app into a connected virtual device', async () => {
    const b = await start();
    const res = await post(b, body());
    expect(res.status).toBe(200);
    expect(b.devices.has('xg-de0000000001')).toBe(true);
    const t = transports[0]!;
    expect(t.url).toBe('mqtt://broker.local:1883');
    expect(t.user).toBe('xg-de0000000001');
    expect(t.connected).toBe(true);
    expect(t.sent.some((topic) => topic.endsWith('/status'))).toBe(true);
  });

  it('re-provisioning replaces the old virtual device (new password after a re-claim)', async () => {
    const b = await start();
    await post(b, body());
    await post(b, body());
    expect(b.devices.size).toBe(1);
    expect(transports[0]!.connected).toBe(false);
    expect(transports[1]!.connected).toBe(true);
  });

  it('rejects credentials for another device and malformed requests', async () => {
    const b = await start();
    expect((await post(b, body('xg-de0000000001', 'xg-de0000000002'))).status).toBe(502);
    expect((await post(b, { hwId: 'nope' })).status).toBe(400);
    expect((await fetch(`${b.url}/v1/sim/other`)).status).toBe(404);
    expect(b.devices.size).toBe(0);
  });

  it('remembers provisioned devices across restarts (dev convenience)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'xg-bridge-')), 'state.json');
    let b = await start(file);
    await post(b, body());
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
    await b.stop();
    b = await start(file);
    expect(b.devices.has('xg-de0000000001')).toBe(true);
    expect(((await (await fetch(`${b.url}/v1/sim/health`)).json()) as { devices: number }).devices).toBe(1);
  });
});
