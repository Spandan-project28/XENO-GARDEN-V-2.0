/**
 * HTTP adapter for services/ml (contract: packages/shared/test-vectors/ml-contract.json).
 * Registered ahead of the rule-based provider when ML_SERVICE_URL is set; any failure (timeout,
 * bad response, service down) makes the registry fall back to rules.
 */
import { healthFinding, healthStatus } from '@xeno/shared';
import { z } from 'zod';
import type { HealthInput, HealthResult, PlantHealthProvider } from './provider.js';

const responseSchema = z.object({
  model: z.object({ name: z.string().min(1).max(60), version: z.string().max(40) }),
  score: z.number().min(0).max(100).nullable(),
  status: healthStatus,
  summary: z.string().max(500),
  findings: z.array(healthFinding).max(20),
});

export interface MlProviderOptions {
  url: string;
  apiKey?: string;
  modelName?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Builds the wire request from the provider input (exported for contract tests). */
export function toMlRequest(input: HealthInput) {
  return {
    plant: input.plant,
    device: input.device ? { id: input.device.id, settings: input.device.settings } : null,
    window: { from: input.window.from.toISOString(), to: input.window.to.toISOString() },
    readings: input.readings.map((r) => ({
      ts: r.ts,
      soilMoisture: r.soilMoisture,
      temperature: r.temperature,
      humidity: r.humidity,
      rain: r.rain,
      pump: r.pump,
    })),
    pumpEvents: input.pumpEvents.map((e) => ({
      source: e.source,
      reason: e.reason,
      stopReason: e.stopReason,
      startedAt: e.startedAt,
      durationSec: e.durationSec,
    })),
    imageUrl: input.imageUrl ?? null,
  };
}

export class MlHealthProvider implements PlantHealthProvider {
  readonly name: string;
  version = 'unknown';

  constructor(private readonly o: MlProviderOptions) {
    this.name = `ml:${o.modelName ?? 'remote'}`;
  }

  async evaluate(input: HealthInput): Promise<HealthResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.o.timeoutMs ?? 10_000);
    try {
      const res = await (this.o.fetchImpl ?? fetch)(`${this.o.url.replace(/\/+$/, '')}/v1/health/predict`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.o.apiKey ? { 'x-ml-key': this.o.apiKey } : {}),
        },
        body: JSON.stringify(toMlRequest(input)),
      });
      if (!res.ok) throw new Error(`ML service responded ${res.status}`);
      const parsed = responseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error('ML service response did not match the contract');
      this.version = `${parsed.data.model.name}@${parsed.data.model.version}`;
      const { score, status, summary, findings } = parsed.data;
      return { score, status, summary, findings };
    } finally {
      clearTimeout(timer);
    }
  }
}
