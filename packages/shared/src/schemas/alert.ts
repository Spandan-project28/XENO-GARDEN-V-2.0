import { z } from 'zod';
import { ALERT_SEVERITIES, ALERT_STATUSES, ALERT_TYPES } from '../constants/index.js';
import { cursorQuery, isoDate, objectId } from './common.js';

export const alertType = z.enum(ALERT_TYPES);
export const alertSeverity = z.enum(ALERT_SEVERITIES);
export const alertStatus = z.enum(ALERT_STATUSES);

export const alertPublic = z.object({
  id: objectId,
  deviceId: objectId,
  deviceName: z.string().nullable(),
  type: alertType,
  severity: alertSeverity,
  status: alertStatus,
  message: z.string(),
  count: z.number().int().positive(),
  firstSeenAt: isoDate,
  lastSeenAt: isoDate,
  acknowledgedAt: isoDate.nullable(),
  resolvedAt: isoDate.nullable(),
  context: z.record(z.string(), z.unknown()),
});
export type AlertPublic = z.infer<typeof alertPublic>;

export const alertsQuery = cursorQuery.extend({
  deviceId: objectId.optional(),
  /** Comma-separated statuses, e.g. "open,acknowledged". */
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((x) => x.trim()) : undefined))
    .pipe(z.array(alertStatus).optional()),
});
export type AlertsQuery = z.infer<typeof alertsQuery>;

export const alertCounts = z.object({
  open: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
});
export type AlertCounts = z.infer<typeof alertCounts>;
