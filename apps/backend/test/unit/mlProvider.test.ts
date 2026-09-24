import { describe, expect, it } from 'vitest';
import contract from '@xeno/shared/test-vectors/ml-contract.json' with { type: 'json' };
import type { PumpEvent } from '@xeno/shared';
import { MlHealthProvider, toMlRequest } from '../../src/modules/insights/ml.js';
import { ProviderRegistry, type HealthInput } from '../../src/modules/insights/provider.js';
import { RuleBasedHealthProvider } from '../../src/modules/insights/rules.js';

const req = contract.request;
const input: HealthInput = {
  plant: req.plant,
  device: { id: req.device.id, name: 'Balcony', settings: req.device.settings },
  window: { from: new Date(req.window.from), to: new Date(req.window.to) },
  readings: req.readings,
  pumpEvents: req.pumpEvents.map(
    (e, i): PumpEvent => ({ ...e, id: `e${i}`, deviceId: req.device.id, source: e.source as PumpEvent['source'], endedAt: null }),
  ),
  imageUrl: null,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('MlHealthProvider (contract)', () => {
  it('sends exactly the contract request', () => {
    expect(toMlRequest(input)).toEqual(req);
  });

  it('parses the contract response and records the model version', async () => {
    let sent: { url: string; headers: Record<string, string> } | null = null;
    const p = new MlHealthProvider({
      url: 'https://ml.example.com/',
      apiKey: 'k1',
      modelName: 'baseline',
      fetchImpl: (async (url: string, init: RequestInit) => {
        sent = { url, headers: init.headers as Record<string, string> };
        return json(200, contract.response);
      }) as typeof fetch,
    });
    const r = await p.evaluate(input);
    expect(r).toEqual({
      score: contract.response.score,
      status: contract.response.status,
      summary: contract.response.summary,
      findings: contract.response.findings,
    });
    expect(p.name).toBe('ml:baseline');
    expect(p.version).toBe('baseline@0.1.0');
    expect(sent!.url).toBe('https://ml.example.com/v1/health/predict');
    expect(sent!.headers['x-ml-key']).toBe('k1');
  });

  it('rejects errors and off-contract responses', async () => {
    const make = (body: unknown, status = 200) =>
      new MlHealthProvider({ url: 'https://ml', fetchImpl: (async () => json(status, body)) as typeof fetch });
    await expect(make({}, 500).evaluate(input)).rejects.toThrow(/500/);
    await expect(make({ ...contract.response, status: 'great' }).evaluate(input)).rejects.toThrow(/contract/);
  });

  it('times out slow services', async () => {
    const p = new MlHealthProvider({
      url: 'https://ml',
      timeoutMs: 20,
      fetchImpl: ((_u: string, init: RequestInit) =>
        new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch,
    });
    await expect(p.evaluate(input)).rejects.toThrow(/aborted/);
  });

  it('falls back to rules when the model service is down', async () => {
    const down = new MlHealthProvider({
      url: 'https://ml',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    const { provider } = await new ProviderRegistry([down, new RuleBasedHealthProvider()]).evaluate(input);
    expect(provider.name).toBe('rules');
  });
});
