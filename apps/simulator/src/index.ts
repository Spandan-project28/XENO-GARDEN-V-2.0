import { SimDevice, type SimClock } from './device.js';
import { createRng } from './physics.js';
import { claimDevice, signIn, simIdentity } from './provision.js';
import { scenarios, type ScenarioName } from './scenarios.js';
import { MqttTransport } from './transport.js';

export * from './device.js';
export * from './physics.js';
export * from './provision.js';
export * from './scenarios.js';
export * from './transport.js';

export interface SimulationOptions {
  /** Backend base URL, e.g. http://localhost:4000 */
  api: string;
  email: string;
  password: string;
  devices: number;
  scenario: ScenarioName;
  /** Override the broker URL from the claim response (e.g. when running behind NAT). */
  mqttUrl?: string;
  seed?: string;
  speed?: number;
  tickMs?: number;
  log?: (msg: string) => void;
}

export interface Simulation {
  devices: SimDevice[];
  deviceIds: string[];
  stop: () => Promise<void>;
}

const realClock: SimClock = { mono: () => performance.now(), epoch: () => Date.now() };

export async function runSimulation(o: SimulationOptions): Promise<Simulation> {
  const log = o.log ?? (() => {});
  const token = await signIn(o.api, o.email, o.password);
  const scenario = scenarios[o.scenario];
  const devices: SimDevice[] = [];
  const deviceIds: string[] = [];

  for (let i = 0; i < o.devices; i++) {
    const id = simIdentity(o.seed ?? o.email, i);
    const claim = await claimDevice(o.api, token, id, `Sim ${scenario.name} ${i + 1}`);
    const url = o.mqttUrl ?? `${claim.mqtt.tls ? 'mqtts' : 'mqtt'}://${claim.mqtt.host}:${claim.mqtt.port}`;
    const device = new SimDevice({
      hardwareId: claim.mqtt.username,
      transport: new MqttTransport({ url, hardwareId: claim.mqtt.username, password: claim.mqtt.password }),
      scenario,
      clock: realClock,
      rng: createRng(i + 1),
      speed: o.speed,
      log,
    });
    await device.start();
    devices.push(device);
    deviceIds.push(claim.device.id);
    log(`▶ ${claim.device.name} (${id.hardwareId}) connected to ${url} — scenario "${scenario.name}"`);
  }

  const timer = setInterval(() => devices.forEach((d) => d.tick()), o.tickMs ?? 1000);
  return {
    devices,
    deviceIds,
    stop: async () => {
      clearInterval(timer);
      await Promise.all(devices.map((d) => d.stop()));
    },
  };
}
