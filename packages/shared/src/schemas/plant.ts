import { z } from 'zod';
import { HEALTH_STATUSES } from '../constants/index.js';
import { isoDate, objectId } from './common.js';

export const plantBody = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
  species: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type PlantBody = z.infer<typeof plantBody>;

export const plantPublic = z.object({
  id: objectId,
  name: z.string(),
  species: z.string().nullable(),
  notes: z.string().nullable(),
  photoUrl: z.string().nullable(),
  deviceId: objectId.nullable(),
  createdAt: isoDate,
});
export type PlantPublic = z.infer<typeof plantPublic>;

export const healthStatus = z.enum(HEALTH_STATUSES);

export const healthFinding = z.object({
  /** Stable machine code, e.g. "moisture_unstable". The app maps codes to icons/copy. */
  code: z.string().min(1).max(60),
  severity: z.enum(['info', 'warning', 'critical']),
  message: z.string(),
  confidence: z.number().min(0).max(1),
});
export type HealthFinding = z.infer<typeof healthFinding>;

export const healthReport = z.object({
  id: objectId,
  plantId: objectId,
  deviceId: objectId.nullable(),
  /** "rules" or "ml:<model-name>". */
  provider: z.string(),
  modelVersion: z.string(),
  score: z.number().min(0).max(100).nullable(),
  status: healthStatus,
  summary: z.string(),
  findings: z.array(healthFinding),
  window: z.object({ from: isoDate, to: isoDate }),
  imageUrl: z.string().nullable(),
  createdAt: isoDate,
});
export type HealthReport = z.infer<typeof healthReport>;

export const healthResponse = z.object({
  latest: healthReport.nullable(),
  history: z.array(healthReport),
});
export type HealthResponse = z.infer<typeof healthResponse>;
