import type { GardenState, PhysicsParams } from './physics.js';
import { DEFAULT_PHYSICS } from './physics.js';

export const SCENARIOS = ['steady', 'drying', 'rain', 'sensor_fault', 'flaky_network', 'offline'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export interface Scenario {
  name: ScenarioName;
  description: string;
  initial: GardenState;
  physics: PhysicsParams;
  /** Called every tick with simulated seconds since start; may mutate garden/flags. */
  script?: (simSec: number, ctx: ScenarioContext) => void;
}

export interface ScenarioContext {
  garden: GardenState;
  setSensorFault(faulty: boolean): void;
  /** Drop the connection without DISCONNECT (like a power cut); reconnect after `sec`. */
  dropConnection(reconnectAfterSec: number | null): void;
  random(): number;
}

const base: GardenState = { soil: 50, temperature: 25, humidity: 55, raining: false };

export const scenarios: Record<ScenarioName, Scenario> = {
  steady: {
    name: 'steady',
    description: 'Healthy garden: slow drying, automation waters occasionally.',
    initial: { ...base, soil: 48 },
    physics: DEFAULT_PHYSICS,
  },
  drying: {
    name: 'drying',
    description: 'Soil dries fast → auto watering kicks in → recovers.',
    initial: { ...base, soil: 36 },
    physics: { ...DEFAULT_PHYSICS, dryRate: 0.08 },
  },
  rain: {
    name: 'rain',
    description: 'Dry soil but it starts raining after 20 s: rain lockout blocks the pump.',
    initial: { ...base, soil: 25 },
    physics: DEFAULT_PHYSICS,
    script: (t, ctx) => {
      ctx.garden.raining = t >= 20 && t < 600;
    },
  },
  sensor_fault: {
    name: 'sensor_fault',
    description: 'Soil sensor disconnects after 30 s and comes back after 5 min.',
    initial: base,
    physics: DEFAULT_PHYSICS,
    script: (t, ctx) => ctx.setSensorFault(t >= 30 && t < 330),
  },
  flaky_network: {
    name: 'flaky_network',
    description: 'Random power-cut style disconnects every ~minute; device keeps working offline.',
    initial: base,
    physics: DEFAULT_PHYSICS,
    script: (t, ctx) => {
      if (t > 10 && ctx.random() < 1 / 60) ctx.dropConnection(3 + Math.floor(ctx.random() * 10));
    },
  },
  offline: {
    name: 'offline',
    description: 'Device goes offline for good after 20 s (tests DEVICE_OFFLINE alerts).',
    initial: base,
    physics: DEFAULT_PHYSICS,
    script: (t, ctx) => {
      if (t === 20) ctx.dropConnection(null);
    },
  },
};
