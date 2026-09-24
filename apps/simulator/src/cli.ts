#!/usr/bin/env node
/**
 * xg-sim — run fake Xeno Garden devices against a backend.
 *
 *   npm run sim -- --devices 2 --scenario drying
 *   npm run sim -- --api https://api.example.com --email me@x.com --password ... --speed 20
 */
import { parseArgs } from 'node:util';
import { runSimulation } from './index.js';
import { SCENARIOS, scenarios, type ScenarioName } from './scenarios.js';

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: process.env.SIM_API_URL ?? 'http://localhost:4000' },
    email: { type: 'string', default: process.env.SIM_EMAIL ?? 'demo@xeno.garden' },
    password: { type: 'string', default: process.env.SIM_PASSWORD ?? 'demo-garden-1' },
    devices: { type: 'string', default: '1' },
    scenario: { type: 'string', default: 'steady' },
    mqtt: { type: 'string' },
    speed: { type: 'string', default: '1' },
    seed: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  // eslint-disable-next-line no-console
  console.log(
    `xg-sim [--api URL] [--email E --password P] [--devices N] [--scenario S] [--speed X] [--mqtt URL]\n\nScenarios:\n${SCENARIOS.map(
      (s) => `  ${s.padEnd(14)} ${scenarios[s].description}`,
    ).join('\n')}`,
  );
  process.exit(0);
}

if (!SCENARIOS.includes(values.scenario as ScenarioName)) {
  // eslint-disable-next-line no-console
  console.error(`Unknown scenario "${values.scenario}". Options: ${SCENARIOS.join(', ')}`);
  process.exit(1);
}

// eslint-disable-next-line no-console
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

const sim = await runSimulation({
  api: values.api!,
  email: values.email!,
  password: values.password!,
  devices: Math.max(1, Number(values.devices)),
  scenario: values.scenario as ScenarioName,
  mqttUrl: values.mqtt,
  seed: values.seed,
  speed: Number(values.speed),
  log,
}).catch((err: Error) => {
  log(`✖ ${err.message}`);
  process.exit(1);
});

log(`Signed in as ${values.email}. Open the app with this account to watch the devices.`);
const status = setInterval(() => {
  for (const d of sim.devices) {
    const r = d.reported();
    log(
      `${d.hardwareId} soil=${d.sensorFault ? '—' : d.garden.soil.toFixed(1)}% pump=${r.pump ? 'ON ' : 'off'} (${r.pumpReason}) mode=${r.mode} v${r.appliedVersion}`,
    );
  }
}, 10_000);

const shutdown = async () => {
  clearInterval(status);
  await sim.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
