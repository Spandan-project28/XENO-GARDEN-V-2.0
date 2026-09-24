/**
 * The plug-in point for plant-health intelligence (plan ADR-007).
 *
 * A provider receives a compact, model-friendly summary of the plant's recent history and
 * returns a score, a status and findings. The rule-based provider ships today; an ML provider
 * (services/ml) implements the same interface over HTTP. The app renders any provider's output.
 */
import type { DeviceSettings, HealthFinding, HealthStatus, PumpEvent, ReadingPoint } from '@xeno/shared';

export interface HealthInput {
  plant: { id: string; name: string; species: string | null };
  device: { id: string; name: string; settings: DeviceSettings } | null;
  window: { from: Date; to: Date };
  /** Hourly buckets over the window (see telemetry/queries). */
  readings: ReadingPoint[];
  pumpEvents: PumpEvent[];
  /** Optional photo for image models. */
  imageUrl?: string | null;
}

export interface HealthResult {
  score: number | null;
  status: HealthStatus;
  summary: string;
  findings: HealthFinding[];
}

export interface PlantHealthProvider {
  /** Stored as `provider` on the report: "rules" or "ml:<model>". */
  readonly name: string;
  readonly version: string;
  evaluate(input: HealthInput): Promise<HealthResult>;
}

/** Chooses the active provider; falls back to the next one if a provider fails. */
export class ProviderRegistry {
  constructor(private readonly chain: PlantHealthProvider[]) {
    if (!chain.length) throw new Error('At least one health provider is required');
  }

  get primary(): PlantHealthProvider {
    return this.chain[0]!;
  }

  async evaluate(
    input: HealthInput,
    onFallback?: (failed: PlantHealthProvider, err: unknown) => void,
  ): Promise<{ provider: PlantHealthProvider; result: HealthResult }> {
    let lastErr: unknown;
    for (const provider of this.chain) {
      try {
        return { provider, result: await provider.evaluate(input) };
      } catch (err) {
        lastErr = err;
        onFallback?.(provider, err);
      }
    }
    throw lastErr;
  }
}
