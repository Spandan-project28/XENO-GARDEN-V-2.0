import { describe, expect, it } from 'vitest';
import { defaultSettings, type PumpEvent, type ReadingPoint } from '@xeno/shared';
import { ProviderRegistry, type HealthInput, type PlantHealthProvider } from '../../src/modules/insights/provider.js';
import { RuleBasedHealthProvider } from '../../src/modules/insights/rules.js';

const T0 = Date.parse('2026-05-01T00:00:00Z');
const H = 3_600_000;

function input(soil: (h: number) => number | null, opts: { temp?: (h: number) => number; events?: PumpEvent[]; hoursN?: number } = {}): HealthInput {
  const hoursN = opts.hoursN ?? 168;
  const readings: ReadingPoint[] = Array.from({ length: hoursN }, (_, h) => ({
    ts: new Date(T0 + h * H).toISOString(),
    soilMoisture: soil(h),
    temperature: opts.temp ? opts.temp(h) : 24,
    humidity: 55,
    rain: 0,
    pump: 0,
  }));
  return {
    plant: { id: 'p', name: 'Basil', species: 'Basil' },
    device: { id: 'd', name: 'Pot', settings: { ...defaultSettings } },
    window: { from: new Date(T0), to: new Date(T0 + hoursN * H) },
    readings,
    pumpEvents: opts.events ?? [],
  };
}

const rules = new RuleBasedHealthProvider();

describe('RuleBasedHealthProvider', () => {
  it('reports "unknown" until there is enough data', async () => {
    const r = await rules.evaluate(input(() => 40, { hoursN: 6 }));
    expect(r).toMatchObject({ status: 'unknown', score: null });
    const noDevice = await rules.evaluate({ ...input(() => 40), device: null });
    expect(noDevice.summary).toMatch(/Link this plant/);
  });

  it('scores a steady, well-watered week as healthy', async () => {
    const r = await rules.evaluate(input((h) => 38 + (h % 5)));
    expect(r.status).toBe('healthy');
    expect(r.score).toBe(100);
    expect(r.findings[0]).toMatchObject({ code: 'moisture_on_target', severity: 'info' });
  });

  it('flags long dry spells as critical', async () => {
    const r = await rules.evaluate(input((h) => (h < 40 ? 15 : 40)));
    expect(r.status).toBe('critical');
    expect(r.findings.find((f) => f.code === 'dry_spells')?.severity).toBe('critical');
  });

  it('flags waterlogging, heat and pump safety stops', async () => {
    const stop = (i: number): PumpEvent => ({
      id: `e${i}`, deviceId: 'd', source: 'auto', reason: 'dry', stopReason: 'max_runtime',
      startedAt: new Date(T0 + i * H).toISOString(), endedAt: new Date(T0 + i * H + 600_000).toISOString(), durationSec: 600,
    });
    const r = await rules.evaluate(
      input((h) => (h < 30 ? 92 : 40), { temp: (h) => (h % 24 > 12 && h % 24 < 16 ? 41 : 25), events: [stop(1), stop(2)] }),
    );
    const codes = r.findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['waterlogging', 'heat_stress', 'pump_safety_stops']));
    expect(r.status).not.toBe('healthy');
    expect(r.score).toBeLessThan(75);
  });

  it('notes sensor gaps and unstable moisture', async () => {
    const r = await rules.evaluate(input((h) => (h % 3 === 0 ? null : h % 2 ? 20 : 70)));
    const codes = r.findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['sensor_gaps', 'moisture_unstable']));
  });
});

describe('ProviderRegistry', () => {
  it('falls back to the next provider when one fails', async () => {
    const broken: PlantHealthProvider = {
      name: 'ml:broken',
      version: '0',
      evaluate: async () => {
        throw new Error('model offline');
      },
    };
    const failures: string[] = [];
    const reg = new ProviderRegistry([broken, rules]);
    const { provider, result } = await reg.evaluate(input(() => 40), (p) => failures.push(p.name));
    expect(provider.name).toBe('rules');
    expect(result.status).toBe('healthy');
    expect(failures).toEqual(['ml:broken']);
  });
});
