import { describe, expect, it } from 'vitest';
import vectors from '../test-vectors/automation.json' with { type: 'json' };
import {
  evaluateAutomation,
  rawToMoisture,
  type AutomationInput,
} from '../src/automation/index.js';

type Vector = {
  name: string;
  input?: Partial<AutomationInput>;
  settings?: Partial<AutomationInput['settings']>;
  expected: unknown;
};

const base = vectors.base as AutomationInput;

describe('evaluateAutomation — golden vectors', () => {
  it('has at least 25 vectors', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(25);
  });

  for (const c of vectors.cases as Vector[]) {
    it(c.name, () => {
      const input: AutomationInput = {
        ...base,
        ...c.input,
        settings: { ...base.settings, ...c.settings },
      };
      expect(evaluateAutomation(input)).toEqual(c.expected);
    });
  }
});

describe('evaluateAutomation — properties', () => {
  it('never keeps the pump on past maxPumpRunSec, whatever else is true', () => {
    for (const mode of ['auto', 'manual'] as const) {
      for (const soil of [null, 0, 40, 100]) {
        for (const rain of [true, false]) {
          const out = evaluateAutomation({
            ...base,
            mode,
            soilMoisture: soil,
            rain,
            pumpOn: true,
            pumpSince: base.now - base.settings.maxPumpRunSec * 1000,
            manual: { cmdId: 'x', pump: 'ON', expiresAt: base.now + 1e6 },
          });
          expect(out.pumpOn).toBe(false);
          expect(out.reason).toBe('max_runtime');
        }
      }
    }
  });

  it('is pure (does not mutate input)', () => {
    const input: AutomationInput = {
      ...base,
      manual: { cmdId: 'm', pump: 'ON', expiresAt: 1 },
    };
    const snapshot = structuredClone(input);
    evaluateAutomation(input);
    expect(input).toEqual(snapshot);
  });
});

describe('rawToMoisture', () => {
  it('maps capacitive (dry=high raw) sensors', () => {
    expect(rawToMoisture(3000, 3000, 1200)).toBe(0);
    expect(rawToMoisture(1200, 3000, 1200)).toBe(100);
    expect(rawToMoisture(2100, 3000, 1200)).toBe(50);
  });
  it('maps resistive (dry=low raw) sensors', () => {
    expect(rawToMoisture(1000, 500, 3500)).toBeCloseTo(16.7, 1);
  });
  it('clamps beyond calibration points', () => {
    expect(rawToMoisture(3500, 3000, 1200)).toBe(0);
    expect(rawToMoisture(800, 3000, 1200)).toBe(100);
  });
  it('flags rail readings as faults', () => {
    expect(rawToMoisture(0, 3000, 1200)).toBeNull();
    expect(rawToMoisture(4095, 3000, 1200)).toBeNull();
  });
  it('rejects unusable calibration', () => {
    expect(rawToMoisture(2000, 2000, 2050)).toBeNull();
  });
});
