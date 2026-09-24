import type { HealthReport as HealthReportDto, HealthResponse } from '@xeno/shared';
import { Types } from 'mongoose';
import { Device, HealthReport, Plant, type DeviceDoc, type HealthReportDoc, type PlantDoc } from '../../db/models.js';
import { notFound } from '../../lib/errors.js';
import type { AlertService } from '../alerts/service.js';
import type { PumpEventService } from '../telemetry/pumpEvents.js';
import type { ReadingQueries } from '../telemetry/queries.js';
import type { ProviderRegistry } from './provider.js';

const WINDOW_DAYS = 7;
const HISTORY_LIMIT = 30;

export function toHealthReportDto(r: HealthReportDoc): HealthReportDto {
  return {
    id: r._id.toHexString(),
    plantId: r.plantId.toHexString(),
    deviceId: r.deviceId ? r.deviceId.toHexString() : null,
    provider: r.provider,
    modelVersion: r.modelVersion,
    score: r.score,
    status: r.status,
    summary: r.summary,
    findings: r.findings,
    window: { from: r.window.from.toISOString(), to: r.window.to.toISOString() },
    imageUrl: r.imageUrl,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface InsightsDeps {
  registry: ProviderRegistry;
  readings: ReadingQueries;
  pumpEvents: PumpEventService;
  alerts: AlertService;
  now: () => Date;
  log: { warn: (o: object, m: string) => void };
}

export function createInsightsService({ registry, readings, pumpEvents, alerts, now, log }: InsightsDeps) {
  async function ownedPlant(userId: string, plantId: string): Promise<PlantDoc> {
    if (!Types.ObjectId.isValid(plantId)) throw notFound('Plant');
    const p = await Plant.findOne({ _id: plantId, ownerId: userId }).lean<PlantDoc>();
    if (!p) throw notFound('Plant');
    return p;
  }

  async function evaluatePlant(plant: PlantDoc, imageUrl: string | null = null): Promise<HealthReportDto> {
    const to = now();
    const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000);
    const device = await Device.findOne({ plantId: plant._id, ownerId: plant.ownerId }).lean<DeviceDoc>();
    const deviceId = device?._id.toHexString();
    const [points, events] = device
      ? await Promise.all([readings.hourlyFromRaw(deviceId!, from, to), pumpEvents.list(deviceId!, from, to)])
      : [[], []];

    const { provider, result } = await registry.evaluate(
      {
        plant: { id: plant._id.toHexString(), name: plant.name, species: plant.species },
        device: device ? { id: deviceId!, name: device.name, settings: device.desired.settings } : null,
        window: { from, to },
        readings: points,
        pumpEvents: events,
        imageUrl,
      },
      (failed, err) => log.warn({ err, provider: failed.name }, 'health provider failed, falling back'),
    );

    const doc = await HealthReport.create({
      plantId: plant._id,
      ownerId: plant.ownerId,
      deviceId: device?._id ?? null,
      provider: provider.name,
      modelVersion: provider.version,
      score: result.score,
      status: result.status,
      summary: result.summary,
      findings: result.findings,
      window: { from, to },
      imageUrl,
    });

    if (result.status === 'critical' && device) {
      await alerts.raise({
        deviceId: deviceId!,
        ownerId: plant.ownerId.toHexString(),
        type: 'PLANT_HEALTH',
        severity: 'warning',
        message: `${plant.name}: ${result.summary}`,
        context: { reportId: doc._id.toHexString(), score: result.score },
        at: to,
      });
    }
    return toHealthReportDto(doc.toObject());
  }

  return {
    async run(userId: string, plantId: string, imageUrl: string | null = null) {
      return evaluatePlant(await ownedPlant(userId, plantId), imageUrl);
    },

    async get(userId: string, plantId: string): Promise<HealthResponse> {
      await ownedPlant(userId, plantId);
      const docs = await HealthReport.find({ plantId })
        .sort({ createdAt: -1 })
        .limit(HISTORY_LIMIT)
        .lean<HealthReportDoc[]>();
      const history = docs.map(toHealthReportDto);
      return { latest: history[0] ?? null, history };
    },

    /** Daily job: evaluates every plant linked to a device whose last report is > 24 h old. */
    async runDue(): Promise<number> {
      const cutoff = new Date(now().getTime() - 24 * 3600_000);
      const linked = await Device.find({ plantId: { $ne: null } }, { plantId: 1 }).lean<DeviceDoc[]>();
      let n = 0;
      for (const d of linked) {
        const recent = await HealthReport.exists({ plantId: d.plantId, createdAt: { $gt: cutoff } });
        if (recent) continue;
        const plant = await Plant.findById(d.plantId).lean<PlantDoc>();
        if (!plant) continue;
        await evaluatePlant(plant).catch((err) => log.warn({ err, plantId: String(d.plantId) }, 'scheduled health check failed'));
        n++;
      }
      return n;
    },
  };
}
export type InsightsService = ReturnType<typeof createInsightsService>;
