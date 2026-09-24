/**
 * History queries over real time ranges. Resolution is picked from the span unless requested:
 *   ≤ 6 h → raw · ≤ 3 d → 5-minute buckets · ≤ 45 d → hourly rollups · longer → daily
 * Raw and 5-minute data come from `readings` (30-day TTL); hourly/daily come from
 * `readings_hourly`, which `rollup()` keeps fresh (run every few minutes by the runtime).
 */
import type { ReadingPoint, ReadingResolution, ReadingsResponse } from '@xeno/shared';
import { Types, type PipelineStage } from 'mongoose';
import { PumpEvent, Reading, ReadingHourly } from '../../db/models.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Resolution = Exclude<ReadingResolution, 'auto'>;

export function pickResolution(from: Date, to: Date, requested: ReadingResolution): Resolution {
  if (requested !== 'auto') return requested;
  const span = to.getTime() - from.getTime();
  if (span <= 6 * HOUR) return 'raw';
  if (span <= 3 * DAY) return '5m';
  if (span <= 45 * DAY) return '1h';
  return '1d';
}

const round = (v: unknown, digits = 1): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null;
const ratio = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, round(v, 3)!)) : 0);

interface Bucket {
  _id: Date;
  soil: number | null;
  soilMin: number | null;
  soilMax: number | null;
  temp: number | null;
  hum: number | null;
  rain: number;
  pump: number;
  n: number;
}

const toPoint = (b: Bucket): ReadingPoint => ({
  ts: b._id.toISOString(),
  soilMoisture: round(b.soil),
  soilMoistureMin: round(b.soilMin),
  soilMoistureMax: round(b.soilMax),
  temperature: round(b.temp),
  humidity: round(b.hum),
  rain: ratio(b.rain),
  pump: ratio(b.pump),
});

const boolToNum = (field: string) => ({ $cond: [`$${field}`, 1, 0] });

export function createReadingQueries() {
  async function raw(deviceId: Types.ObjectId, from: Date, to: Date): Promise<ReadingPoint[]> {
    const docs = await Reading.find({ deviceId, ts: { $gte: from, $lte: to } })
      .sort({ ts: 1 })
      .limit(5000)
      .lean();
    return docs.map((r) => ({
      ts: r.ts.toISOString(),
      soilMoisture: round(r.soilMoisture),
      temperature: round(r.temperature),
      humidity: round(r.humidity),
      rain: r.rain ? 1 : 0,
      pump: r.pump ? 1 : 0,
    }));
  }

  async function bucketed(
    deviceId: Types.ObjectId,
    from: Date,
    to: Date,
    unit: 'minute' | 'hour',
    binSize: number,
  ): Promise<ReadingPoint[]> {
    const pipeline: PipelineStage[] = [
      { $match: { deviceId, ts: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$ts', unit, binSize } },
          soil: { $avg: '$soilMoisture' },
          soilMin: { $min: '$soilMoisture' },
          soilMax: { $max: '$soilMoisture' },
          temp: { $avg: '$temperature' },
          hum: { $avg: '$humidity' },
          rain: { $avg: boolToNum('rain') },
          pump: { $avg: boolToNum('pump') },
          n: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];
    return (await Reading.aggregate<Bucket>(pipeline)).map(toPoint);
  }

  async function fromHourly(
    deviceId: Types.ObjectId,
    from: Date,
    to: Date,
    unit: 'hour' | 'day',
    tz: string,
  ): Promise<ReadingPoint[]> {
    const w = (f: string) => ({ $multiply: [`$${f}`, '$samples'] });
    const pipeline: PipelineStage[] = [
      { $match: { deviceId, hour: { $gte: new Date(from.getTime() - (from.getTime() % HOUR)), $lte: to } } },
      {
        $group: {
          _id: unit === 'hour' ? '$hour' : { $dateTrunc: { date: '$hour', unit: 'day', timezone: tz } },
          soilW: { $sum: w('soilAvg') },
          soilN: { $sum: { $cond: [{ $ne: ['$soilAvg', null] }, '$samples', 0] } },
          soilMin: { $min: '$soilMin' },
          soilMax: { $max: '$soilMax' },
          tempW: { $sum: w('tempAvg') },
          tempN: { $sum: { $cond: [{ $ne: ['$tempAvg', null] }, '$samples', 0] } },
          humW: { $sum: w('humidityAvg') },
          humN: { $sum: { $cond: [{ $ne: ['$humidityAvg', null] }, '$samples', 0] } },
          rainW: { $sum: w('rainRatio') },
          pumpW: { $sum: w('pumpRatio') },
          n: { $sum: '$samples' },
        },
      },
      {
        $project: {
          soil: { $cond: [{ $gt: ['$soilN', 0] }, { $divide: ['$soilW', '$soilN'] }, null] },
          soilMin: 1,
          soilMax: 1,
          temp: { $cond: [{ $gt: ['$tempN', 0] }, { $divide: ['$tempW', '$tempN'] }, null] },
          hum: { $cond: [{ $gt: ['$humN', 0] }, { $divide: ['$humW', '$humN'] }, null] },
          rain: { $cond: [{ $gt: ['$n', 0] }, { $divide: ['$rainW', '$n'] }, 0] },
          pump: { $cond: [{ $gt: ['$n', 0] }, { $divide: ['$pumpW', '$n'] }, 0] },
          n: 1,
        },
      },
      { $sort: { _id: 1 } },
    ];
    return (await ReadingHourly.aggregate<Bucket>(pipeline)).map(toPoint);
  }

  async function pumpOnSec(deviceId: Types.ObjectId, from: Date, to: Date, now: Date): Promise<number> {
    const events = await PumpEvent.find({
      deviceId,
      startedAt: { $lte: to },
      $or: [{ endedAt: null }, { endedAt: { $gte: from } }],
    }).lean();
    let ms = 0;
    for (const e of events) {
      const start = Math.max(e.startedAt.getTime(), from.getTime());
      const end = Math.min((e.endedAt ?? now).getTime(), to.getTime());
      if (end > start) ms += end - start;
    }
    return Math.round(ms / 1000);
  }

  const avg = (pts: ReadingPoint[], key: 'soilMoisture' | 'temperature' | 'humidity') => {
    const vals = pts.map((p) => p[key]).filter((v): v is number => v !== null);
    return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };

  return {
    /** Hourly buckets straight from raw readings (≤ 30 days) — used by plant-health checks. */
    hourlyFromRaw: (deviceId: string, from: Date, to: Date) =>
      bucketed(new Types.ObjectId(deviceId), from, to, 'hour', 1),

    async query(
      deviceId: string,
      q: { from: string; to: string; resolution: ReadingResolution; tz?: string },
      now: Date,
    ): Promise<ReadingsResponse> {
      const from = new Date(q.from);
      const to = new Date(q.to);
      const id = new Types.ObjectId(deviceId);
      const resolution = pickResolution(from, to, q.resolution);
      const points =
        resolution === 'raw'
          ? await raw(id, from, to)
          : resolution === '5m'
            ? await bucketed(id, from, to, 'minute', 5)
            : await fromHourly(id, from, to, resolution === '1h' ? 'hour' : 'day', q.tz ?? 'UTC');
      return {
        resolution,
        from: from.toISOString(),
        to: to.toISOString(),
        points,
        stats: {
          soilMoistureAvg: avg(points, 'soilMoisture'),
          temperatureAvg: avg(points, 'temperature'),
          humidityAvg: avg(points, 'humidity'),
          pumpOnSec: await pumpOnSec(id, from, to, now),
          samples: points.length,
        },
      };
    },

    /**
     * Upserts hourly rollups for every hour touching [from, to]. Idempotent, so it can re-run
     * over the current hour as new readings arrive.
     */
    async rollup(from: Date, to: Date): Promise<void> {
      const start = new Date(from.getTime() - (from.getTime() % HOUR));
      await Reading.aggregate([
        { $match: { ts: { $gte: start, $lte: to } } },
        {
          $group: {
            _id: { deviceId: '$deviceId', hour: { $dateTrunc: { date: '$ts', unit: 'hour' } } },
            samples: { $sum: 1 },
            soilAvg: { $avg: '$soilMoisture' },
            soilMin: { $min: '$soilMoisture' },
            soilMax: { $max: '$soilMoisture' },
            tempAvg: { $avg: '$temperature' },
            humidityAvg: { $avg: '$humidity' },
            rainRatio: { $avg: boolToNum('rain') },
            pumpRatio: { $avg: boolToNum('pump') },
          },
        },
        {
          $project: {
            _id: 0,
            deviceId: '$_id.deviceId',
            hour: '$_id.hour',
            samples: 1,
            soilAvg: 1,
            soilMin: 1,
            soilMax: 1,
            tempAvg: 1,
            humidityAvg: 1,
            rainRatio: 1,
            pumpRatio: 1,
          },
        },
        {
          $merge: {
            into: 'readings_hourly',
            on: ['deviceId', 'hour'],
            whenMatched: 'replace',
            whenNotMatched: 'insert',
          },
        },
      ]);
    },
  };
}
export type ReadingQueries = ReturnType<typeof createReadingQueries>;
