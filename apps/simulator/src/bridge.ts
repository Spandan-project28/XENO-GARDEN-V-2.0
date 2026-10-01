/**
 * Development "virtual radio" (implementation_plan P10.9).
 *
 * In Expo Go there is no Bluetooth, so the app's demo devices are simulated on the phone. When the
 * app finishes setting one up, it POSTs here what a real ESP32 would have received over BLE (the
 * cloud credentials from the claim + the chosen WiFi name). The simulator then starts a matching
 * virtual device that connects to the real broker with those credentials, so the demo device
 * comes online with live data — the whole simple-mode flow, end to end, without hardware.
 *
 * Dev only: it can only start devices with credentials the backend issued, and it never serves
 * anything sensitive.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { cloudCredsPayload, HARDWARE_ID_PATTERN, type CloudCredsPayload } from '@xeno/shared';
import { z } from 'zod';
import { SimDevice, type SimClock, type SimTransport } from './device.js';
import { createRng } from './physics.js';
import { scenarios, type ScenarioName } from './scenarios.js';
import { MqttTransport } from './transport.js';

export const bridgeProvisionBody = z.object({
  hwId: z.string().regex(HARDWARE_ID_PATTERN),
  cloud: cloudCredsPayload,
  ssid: z.string().min(1).max(32),
});
export type BridgeProvisionBody = z.infer<typeof bridgeProvisionBody>;

export interface BridgeOptions {
  port: number;
  host?: string;
  scenario?: ScenarioName;
  speed?: number;
  /** Remembers provisioned devices so they come back after a restart (dev convenience). */
  stateFile?: string;
  /** Tests inject a fake transport. */
  transportFactory?: (url: string, creds: CloudCredsPayload) => SimTransport;
  tickMs?: number;
  log?: (msg: string) => void;
}

export interface Bridge {
  url: string;
  devices: Map<string, SimDevice>;
  stop(): Promise<void>;
}

const realClock: SimClock = { mono: () => performance.now(), epoch: () => Date.now() };
const MAX_BODY = 4096;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startBridge(o: BridgeOptions): Promise<Bridge> {
  const log = o.log ?? (() => {});
  const scenario = scenarios[o.scenario ?? 'steady'];
  const devices = new Map<string, SimDevice>();
  const saved = new Map<string, BridgeProvisionBody>();
  let n = 0;

  const makeTransport =
    o.transportFactory ??
    ((url: string, c: CloudCredsPayload) => new MqttTransport({ url, hardwareId: c.u, password: c.pw }));

  async function provision(body: BridgeProvisionBody) {
    const { hwId, cloud } = body;
    if (cloud.u !== hwId) throw new Error('credentials are for another device');
    await devices.get(hwId)?.stop();
    const url = `${cloud.t ? 'mqtts' : 'mqtt'}://${cloud.h}:${cloud.p}`;
    const device = new SimDevice({
      hardwareId: hwId,
      transport: makeTransport(url, cloud),
      scenario,
      clock: realClock,
      rng: createRng(++n + 100),
      speed: o.speed,
      log,
    });
    await device.start();
    devices.set(hwId, device);
    saved.set(hwId, body);
    if (o.stateFile) writeFileSync(o.stateFile, JSON.stringify([...saved.values()], null, 2));
    log(`▶ virtual device ${hwId} joined “${body.ssid}” and connected to ${url}`);
  }

  // Bring back devices provisioned in an earlier run.
  if (o.stateFile && existsSync(o.stateFile)) {
    try {
      const list = z.array(bridgeProvisionBody).parse(JSON.parse(readFileSync(o.stateFile, 'utf8')));
      for (const b of list) await provision(b).catch((e: Error) => log(`✖ ${b.hwId}: ${e.message}`));
    } catch {
      log('✖ ignoring unreadable bridge state file');
    }
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'GET' && req.url === '/v1/sim/health') return send(res, 200, { ok: true, devices: devices.size });
      if (req.method !== 'POST' || req.url !== '/v1/sim/provision') return send(res, 404, { error: 'not found' });
      let body: BridgeProvisionBody;
      try {
        body = bridgeProvisionBody.parse(JSON.parse(await readBody(req)));
      } catch {
        return send(res, 400, { error: 'invalid body' });
      }
      try {
        await provision(body);
        send(res, 200, { ok: true });
      } catch (err) {
        send(res, 502, { error: (err as Error).message });
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(o.port, o.host ?? '0.0.0.0', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : o.port;
  const timer = setInterval(() => devices.forEach((d) => d.tick()), o.tickMs ?? 1000);
  log(`Virtual radio listening on port ${port} (demo devices from the app come alive here)`);

  return {
    url: `http://127.0.0.1:${port}`,
    devices,
    stop: async () => {
      clearInterval(timer);
      await new Promise<void>((r) => server.close(() => r()));
      await Promise.all([...devices.values()].map((d) => d.stop()));
    },
  };
}
