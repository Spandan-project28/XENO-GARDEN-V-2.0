#!/usr/bin/env node
/**
 * One-command local development — no Docker, no manual IPs:
 *
 *   npm run dev                 backend (watch) + embedded MQTT + local Mongo — real devices only
 *   npm run dev:demo            the same + simulated devices (demo without hardware)
 *                               + the simulator's "virtual radio" (port 4100), so the app's demo
 *                               devices (Expo Go has no Bluetooth) come alive when you set them up
 *   npm run dev -- --sim        same as dev:demo
 *   npm run dev -- --scenario drying --devices 2
 *
 * • MongoDB: uses $MONGO_URI if set, otherwise starts a persistent local mongod
 *   (mongodb-memory-server binary, data in .data/mongo).
 * • Detects this machine's LAN address so phones and real ESP32 boards on the same WiFi can
 *   reach the dev backend, and writes it to apps/mobile/.env.local (EXPO_PUBLIC_API_URL).
 * • A random JWT secret is generated once and kept in .data/dev-secrets.json.
 * • If the firmware has been built (firmware/.pio/build/esp32dev/firmware.bin), it is offered as a
 *   firmware update over WiFi: the app's "Update firmware" button installs it on boards that run
 *   an older version — no USB cable needed.
 * • Plant Scan: if no disease model API is configured in apps/backend/.env (SCAN_API_URL /
 *   SCAN_API_PRESET) and the local model is downloaded (services/ml: python -m app.fetch_model),
 *   the local model service is started too, so leaf scans work out of the box. Optional: any
 *   problem here is logged and the irrigation server runs as usual.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.data');
mkdirSync(dataDir, { recursive: true });

const { values: args } = parseArgs({
  options: {
    sim: { type: 'boolean', default: false },
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

/**
 * Serves the locally built firmware over HTTPS (boards only download updates over https; the
 * image is checked against its SHA-256, so a self-signed certificate is enough on the LAN).
 */
async function localFirmwareRelease(host) {
  const bin = join(root, 'firmware', '.pio', 'build', 'esp32dev', 'firmware.bin');
  const config = join(root, 'firmware', 'include', 'config.h');
  if (!existsSync(bin) || !existsSync(config)) return {};
  const version = /#define XG_FW_VERSION "([^"]+)"/.exec(readFileSync(config, 'utf8'))?.[1];
  if (!version) return {};
  if (statSync(config).mtimeMs > statSync(bin).mtimeMs) {
    log(`Firmware ${version} is not built yet (config.h is newer than firmware.bin): no update offered`);
    return {};
  }
  const image = readFileSync(bin);
  const sha256 = createHash('sha256').update(image).digest('hex');
  const certFile = join(dataDir, 'ota-cert.json');
  let cert = existsSync(certFile) ? JSON.parse(readFileSync(certFile, 'utf8')) : null;
  if (!cert) {
    const { generate } = await import('selfsigned');
    const c = await generate([{ name: 'commonName', value: 'xeno-dev-ota' }], { days: 3650, keySize: 2048 });
    cert = { key: c.private, cert: c.cert };
    writeFileSync(certFile, JSON.stringify(cert));
  }
  const { createServer } = await import('node:https');
  const path = `/firmware/${version}.bin`;
  const server = createServer(cert, (req, res) => {
    if (req.url !== path) return res.writeHead(404).end();
    log(`Board is downloading firmware ${version}`);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': image.length }).end(image);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(OTA_PORT, '0.0.0.0', resolve));
  log(`Firmware ${version} offered as an update over WiFi (app → device → Firmware)`);
  return {
    FIRMWARE_LATEST_VERSION: version,
    FIRMWARE_LATEST_URL: `https://${host}:${OTA_PORT}${path}`,
    FIRMWARE_LATEST_SHA256: sha256,
  };
}

const SCAN_ML_PORT = 8000;

/** Python launcher that has the scan model's packages, or null. */
function findPython() {
  const check = 'import onnxruntime, fastapi, uvicorn, multipart, PIL';
  for (const [cmd, pre] of [['py', ['-3']], ['python', []], ['python3', []]]) {
    const r = spawnSync(cmd, [...pre, '-c', check], { stdio: 'ignore', timeout: 20_000 });
    if (r.status === 0) return [cmd, pre];
  }
  return null;
}

/**
 * Starts services/ml for Plant Scan when nothing else is configured. Returns the backend env
 * that points Plant Scan at it ({} when the user's own model API is set up, or it can't start).
 */
async function localScanModel() {
  const backendEnv = join(root, 'apps', 'backend', '.env');
  const own = /^[ \t]*SCAN_API_(URL|PRESET)[ \t]*=[ \t]*[^\s#]/m;
  if (process.env.SCAN_API_URL || process.env.SCAN_API_PRESET || (existsSync(backendEnv) && own.test(readFileSync(backendEnv, 'utf8')))) {
    log('Plant Scan: using the model API set in apps/backend/.env');
    return {};
  }
  const mlDir = join(root, 'services', 'ml');
  if (!existsSync(join(mlDir, 'models', 'plant-disease', 'model.onnx'))) {
    log('Plant Scan: no model yet (add your API to apps/backend/.env, or: cd services/ml && python -m app.fetch_model)');
    return {};
  }
  if (await portInUse(SCAN_ML_PORT)) {
    log(`Plant Scan: port ${SCAN_ML_PORT} is busy, assuming the local model service is already running`);
    return { SCAN_API_PRESET: 'xeno-ml', SCAN_API_URL: `http://127.0.0.1:${SCAN_ML_PORT}/v1/scan/predict` };
  }
  const py = findPython();
  if (!py) {
    log('Plant Scan: Python packages missing (cd services/ml && pip install -r requirements.txt), scans disabled');
    return {};
  }
  const child = spawn(py[0], [...py[1], '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(SCAN_ML_PORT), '--log-level', 'warning'], {
    cwd: mlDir,
    env: { ...process.env, ML_API_KEY: '' },
    stdio: 'inherit',
  });
  child.on('error', (e) => log(`Plant Scan: local model service failed to start (${e.message})`));
  child.on('exit', (code) => code && log(`Plant Scan: local model service stopped (code ${code})`));
  children.push(child);
  log(`Plant Scan: local leaf-disease model on 127.0.0.1:${SCAN_ML_PORT} (PlantVillage MobileNetV2)`);
  return { SCAN_API_PRESET: 'xeno-ml', SCAN_API_URL: `http://127.0.0.1:${SCAN_ML_PORT}/v1/scan/predict`, SCAN_API_MODEL_NAME: 'Xeno local model (PlantVillage)' };
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
const OTA_PORT = 4443;
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
for (const p of [port, mqttPort, OTA_PORT]) {
  if (await portInUse(p)) {
    console.error(
      `\x1b[31m[dev]\x1b[0m Port ${p} is already in use: another "npm run dev" is probably still running.\n` +
        '      Close that terminal (or press Ctrl+C in it), then run "npm run dev" again.',
    );
    process.exit(1);
  }
}

const mongo = await startMongo();
const firmwareRelease = await localFirmwareRelease(lan).catch((e) => {
  log(`Firmware update over WiFi not available: ${e.message}`);
  return {};
});

// Let the Expo app find the dev backend automatically.
const mobileEnv = join(root, 'apps', 'mobile', '.env.local');
if (existsSync(join(root, 'apps', 'mobile'))) {
  // No fixed address any more: in development the app finds this server on the same machine that
  // serves its JavaScript (Metro), so it keeps working after the PC moves to another network.
  writeFileSync(
    mobileEnv,
    `# written by tools/dev.mjs — do not commit (the app finds the dev server by itself)\n` +
      (args.sim ? 'EXPO_PUBLIC_FLAG_DEMO_PROVISIONING=true\n' : ''),
  );
  log(`Mobile app will find this server automatically (now ${apiUrl})`);
}

log('Building shared contracts…');
await new Promise((resolve, reject) =>
  run('build', 'npm', ['run', 'build', '-w', '@xeno/shared', '-w', '@xeno/simulator'], {}).on('exit', (c) =>
    c === 0 ? resolve() : reject(new Error('build failed')),
  ),
);

const scanEnv = await localScanModel().catch((e) => {
  log(`Plant Scan: local model not started (${e.message})`);
  return {};
});

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
  ...firmwareRelease,
  ...scanEnv,
  ...devSecrets(),
});

await waitForHealth(`http://127.0.0.1:${port}`);
log(`Backend ready → ${apiUrl}  (Swagger: ${apiUrl}/docs, MQTT: ${lan}:${mqttPort})`);

if (args.sim) {
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
} else {
  log('Ready — real devices only. KEEP THIS WINDOW OPEN while you use the app (Ctrl+C to stop).');
}

const shutdown = async () => {
  for (const c of children) c.kill('SIGINT');
  await mongo.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
