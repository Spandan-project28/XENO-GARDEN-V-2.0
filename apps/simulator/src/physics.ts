/**
 * A tiny garden model: soil dries through evaporation (faster when hot/dry air), the pump and rain
 * wet it. Deterministic given a seeded RNG so tests are reproducible.
 */

export interface Rng {
  next(): number; // [0, 1)
}

/** Mulberry32 — small, fast, deterministic. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export interface GardenState {
  soil: number; // %
  temperature: number; // °C
  humidity: number; // %
  raining: boolean;
}

export interface PhysicsParams {
  /** % per simulated second lost to evaporation at 25 °C / 50 % RH. */
  dryRate: number;
  /** % per simulated second added while the pump runs. */
  pumpRate: number;
  /** % per simulated second added while it rains. */
  rainRate: number;
}

export const DEFAULT_PHYSICS: PhysicsParams = { dryRate: 0.01, pumpRate: 0.25, rainRate: 0.05 };

/** Advances the garden by `dtSec` simulated seconds. Temperature follows a daily sine. */
export function step(
  s: GardenState,
  dtSec: number,
  pumpOn: boolean,
  wallClock: Date,
  p: PhysicsParams,
  rng: Rng,
): GardenState {
  const hour = wallClock.getHours() + wallClock.getMinutes() / 60;
  const daily = Math.sin(((hour - 9) / 24) * 2 * Math.PI); // peak ~15:00
  const temperature = 26 + 7 * daily + (rng.next() - 0.5) * 0.4;
  const humidity = Math.min(95, Math.max(20, 60 - 20 * daily + (s.raining ? 25 : 0) + (rng.next() - 0.5)));
  const heat = Math.max(0.3, 1 + (temperature - 25) * 0.06 + (50 - humidity) * 0.01);

  let soil = s.soil - p.dryRate * heat * dtSec;
  if (pumpOn) soil += p.pumpRate * dtSec;
  if (s.raining) soil += p.rainRate * dtSec;
  soil = Math.min(100, Math.max(0, soil));

  return { soil, temperature, humidity, raining: s.raining };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** What a real capacitive sensor would report: noisy % and raw ADC (dry ≈ 3000, wet ≈ 1200). */
export function readSensors(s: GardenState, rng: Rng) {
  const soilMoisture = round1(Math.min(100, Math.max(0, s.soil + (rng.next() - 0.5) * 0.6)));
  const soilRaw = Math.round(3000 - (soilMoisture / 100) * 1800);
  return {
    soilMoisture,
    soilRaw,
    temperature: round1(s.temperature),
    humidity: round1(s.humidity),
    rain: s.raining,
  };
}
