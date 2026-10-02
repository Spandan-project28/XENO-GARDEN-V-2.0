#!/usr/bin/env node
/**
 * One-command local development — no Docker, no manual IPs:
 *
 *   npm run dev                 backend (watch) + embedded MQTT + local Mongo + 1 simulated device
 *                               + the simulator's "virtual radio" (port 4100), so the app's demo
 *                               devices (Expo Go has no Bluetooth) come alive when you set them up
 *   npm run dev -- --no-sim     without the simulator
 *   npm run dev -- --scenario drying --devices 2
 *
 * • MongoDB: uses $MONGO_URI if set, otherwise starts a persistent local mongod
 *   (mongodb-memory-server binary, data in .data/mongo).
 * • Detects this machine's LAN address so phones and real ESP32 boards on the same WiFi can
 *   reach the dev backend, and writes it to apps/mobile/.env.local (EXPO_PUBLIC_API_URL).
 * • A random JWT secret is generated once and kept in .data/dev-secrets.json.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.data');
mkdirSync(dataDir, { recursive: true });

const { values: args } = parseArgs({
  options: {
    'no-sim': { type: 'boolean', default: false },
    scenario: { type: 'string', default: 'steady' },
    devices: { type: 'string', default: '1' },
    port: { type: 'string', default: process.env.PORT ?? '4000' },
    'mqtt-port': { type: 'string', default: process.env.MQTT_EMBEDDED_PORT ?? '1883' },
  },
});

const log = (m) => console.log(`\x1b[32m[dev]\x1b[0m ${m}`);

/** Best guess at the address other devices on the WiFi can reach us on. */
export function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const virtual = /vEthernet|VirtualBox|VMware|docker|WSL|Hyper-V|br-|veth/i.test(name);
      const privateNet = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      candidates.push({ address: a.address, score: (privateNet ? 2 : 0) + (virtual ? -3 : 1) });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  return candidates[0]?.address ?? '127.0.0.1';
}

function devSecrets() {
  const file = join(dataDir, 'dev-secrets.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const s = { JWT_ACCESS_SECRET: randomBytes(32).toString('base64url') };
  writeFileSync(file, JSON.stringify(s, null, 2));
  return s;
}

async function startMongo() {
  if (process.env.MONGO_URI) {
    log(`Using MONGO_URI from environment`);
    return { uri: process.env.MONGO_URI, stop: async () => {} };
  }
  process.env.MONGOMS_DOWNLOAD_DIR ??= join(root, 'node_modules', '.cache', 'mongodb-memory-server');
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const dbPath = join(dataDir, 'mongo');
  mkdirSync(dbPath, { recursive: true });
  const server = await MongoMemoryServer.create({
    instance: { dbPath, storageEngine: 'wiredTiger', port: 27018 },
  });
  const uri = server.getUri('xeno_garden');
  log(`Local MongoDB ready (${uri}, data in .data/mongo)`);
  return { uri, stop: () => server.stop({ doCleanup: false }) };
}

async function waitForHealth(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/v1/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('backend did not become healthy in time');
}

const children = [];
function run(name, cmd, cmdArgs, env) {
  const child = spawn(cmd, cmdArgs, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    if (code && code !== 0) log(`${name} exited with code ${code}`);
  });
  children.push(child);
  return child;
}

const lan = lanAddress();
const SIM_BRIDGE_PORT = 4100;
const port = Number(args.port);
const mqttPort = Number(args['mqtt-port']);
const apiUrl = `http://${lan}:${port}`;

// Two dev servers at once is a trap: the old one keeps the port (and its old network address).
async function portInUse(p) {
  const { createServer } = await import('node:net');
  return new Promise((resolve) => {
    const srv = createServer()
      .once('error', () => resolve(true))
      .once('listening', () => srv.close(() => resolve(false)))
      .listen(p, '0.0.0.0');
  });
}
for (const p of [port, mqttPort]) {
  if (await portInUse(p)) {
    console.error(
      `\x1b[31m[dev]\x1b[0m Port ${p} is already in use: another "npm run dev" is probably still running.\n` +
        '      Close that terminal (or press Ctrl+C in it), then run "npm run dev" again.',
    );
    process.exit(1);
  }
}

const mongo = await startMongo();

// Let the Expo app find the dev backend automatically.
const mobileEnv = join(root, 'apps', 'mobile', '.env.local');
if (existsSync(join(root, 'apps', 'mobile'))) {
  // No fixed address any more: in development the app finds this server on the same machine that
  // serves its JavaScript (Metro), so it keeps working after the PC moves to another network.
  writeFileSync(mobileEnv, `# written by tools/dev.mjs — do not commit (the app finds the dev server by itself)\n`);
  log(`Mobile app will find this server automatically (now ${apiUrl})`);
}

log('Building shared contracts…');
await new Promise((resolve, reject) =>
  run('build', 'npm', ['run', 'build', '-w', '@xeno/shared', '-w', '@xeno/simulator'], {}).on('exit', (c) =>
    c === 0 ? resolve() : reject(new Error('build failed')),
  ),
);

run('backend', 'npm', ['run', 'dev', '-w', '@xeno/backend'], {
  NODE_ENV: 'development',
  PORT: String(port),
  MONGO_URI: mongo.uri,
  MQTT_EMBEDDED: 'true',
  MQTT_EMBEDDED_PORT: String(mqttPort),
  // Devices get the address the phone used to reach this server (follows network changes).
  DEVICE_BROKER_HOST: 'auto',
  DEVICE_BROKER_PORT: String(mqttPort),
  DEVICE_BROKER_TLS: 'false',
  ...devSecrets(),
});

await waitForHealth(`http://127.0.0.1:${port}`);
log(`Backend ready → ${apiUrl}  (Swagger: ${apiUrl}/docs, MQTT: ${lan}:${mqttPort})`);

if (!args['no-sim']) {
  run(
    'simulator',
    'npm',
    [
      'run', 'sim', '-w', '@xeno/simulator', '--',
      '--api', `http://127.0.0.1:${port}`,
      '--devices', args.devices,
      '--scenario', args.scenario,
      '--bridge-port', String(SIM_BRIDGE_PORT),
      '--bridge-state', join(dataDir, 'sim-bridge.json'),
    ],
    {},
  );
  log('Simulator running. In the app, tap "Find my devices" to add the demo devices (Xeno-DEM1/DEM2).');
  log('The simulator also runs its own device for the account demo@xeno.garden / demo-garden-1.');
}

const shutdown = async () => {
  for (const c of children) c.kill('SIGINT');
  await mongo.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
