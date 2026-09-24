import { z } from 'zod';
import { READING_RESOLUTIONS } from '../constants/index.js';
import { isoDate } from './common.js';

export const readingsQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    resolution: z.enum(READING_RESOLUTIONS).default('auto'),
    /** IANA time zone used for daily buckets, e.g. "Asia/Kolkata". Defaults to UTC. */
    tz: z
      .string()
      .max(64)
      .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/, 'Invalid time zone')
      .optional(),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), {
    message: '`from` must be before `to`',
    path: ['from'],
  })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 24 * 3600 * 1000, {
    message: 'Range must be at most 366 days',
    path: ['to'],
  });
export type ReadingsQuery = z.infer<typeof readingsQuery>;

/**
 * One chart point. For raw resolution, rain/pump are 0 or 1. For bucketed
 * resolutions they are the fraction of the bucket where rain/pump was on (0..1).
 */
export const readingPoint = z.object({
  ts: isoDate,
  soilMoisture: z.number().nullable(),
  soilMoistureMin: z.number().nullable().optional(),
  soilMoistureMax: z.number().nullable().optional(),
  temperature: z.number().nullable(),
  humidity: z.number().nullable(),
  rain: z.number().min(0).max(1),
  pump: z.number().min(0).max(1),
});
export type ReadingPoint = z.infer<typeof readingPoint>;

export const readingsResponse = z.object({
  resolution: z.enum(READING_RESOLUTIONS).exclude(['auto']),
  from: isoDate,
  to: isoDate,
  points: z.array(readingPoint),
  stats: z.object({
    soilMoistureAvg: z.number().nullable(),
    temperatureAvg: z.number().nullable(),
    humidityAvg: z.number().nullable(),
    pumpOnSec: z.number().nonnegative(),
    samples: z.number().int().nonnegative(),
  }),
});
export type ReadingsResponse = z.infer<typeof readingsResponse>;

export const pumpEventSource = z.enum(['auto', 'manual', 'safety']);
export type PumpEventSource = z.infer<typeof pumpEventSource>;

export const pumpEvent = z.object({
  id: z.string(),
  deviceId: z.string(),
  source: pumpEventSource,
  reason: z.string(),
  stopReason: z.string().nullable(),
  startedAt: isoDate,
  endedAt: isoDate.nullable(),
  durationSec: z.number().nonnegative().nullable(),
});
export type PumpEvent = z.infer<typeof pumpEvent>;

export const pumpEventsQuery = z.object({
  from: isoDate,
  to: isoDate,
});
export type PumpEventsQuery = z.infer<typeof pumpEventsQuery>;
