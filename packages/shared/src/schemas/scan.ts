/**
 * Plant Scan: leaf photo → disease model → one standard result, whatever model is plugged in.
 * The backend normalises every model's answer into `scanPublic`; the app only renders this.
 */
import { z } from 'zod';
import { isoDate, objectId } from './common.js';
import { photoContentType, signedUpload } from './plant.js';

export const SCAN_STATUSES = ['healthy', 'disease', 'uncertain', 'not_plant'] as const;
export const scanStatusKind = z.enum(SCAN_STATUSES);
export type ScanStatusKind = z.infer<typeof scanStatusKind>;

export const SCAN_CATEGORIES = ['healthy', 'fungal', 'bacterial', 'viral', 'pest', 'nutrient', 'unknown'] as const;
export const scanCategory = z.enum(SCAN_CATEGORIES);
export type ScanCategory = z.infer<typeof scanCategory>;

export const SCAN_SEVERITIES = ['none', 'low', 'medium', 'high'] as const;
export const scanSeverity = z.enum(SCAN_SEVERITIES);
export type ScanSeverity = z.infer<typeof scanSeverity>;

/** A tip that comes from the linked Xeno device's live sensors (humidity, soil, rain…). */
export const scanSensorTip = z.object({
  code: z.string().min(1).max(60),
  tone: z.enum(['info', 'good', 'warning']),
  message: z.string(),
});
export type ScanSensorTip = z.infer<typeof scanSensorTip>;

export const scanAlternative = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ScanAlternative = z.infer<typeof scanAlternative>;

/** Snapshot of the garden conditions the tips were based on. */
export const scanConditions = z.object({
  soilMoisture: z.number().nullable(),
  temperature: z.number().nullable(),
  humidity: z.number().nullable(),
  rain: z.boolean().nullable(),
  at: isoDate.nullable(),
});
export type ScanConditions = z.infer<typeof scanConditions>;

export const scanPublic = z.object({
  id: objectId,
  createdAt: isoDate,
  deviceId: objectId.nullable(),
  deviceName: z.string().nullable(),
  /** Short-lived signed URL of the photo. */
  imageUrl: z.string().nullable(),
  status: scanStatusKind,
  category: scanCategory,
  severity: scanSeverity,
  /** Display title, e.g. "Early blight", "Healthy leaf", "Not sure". */
  title: z.string(),
  crop: z.string().nullable(),
  condition: z.string().nullable(),
  /** 0..1, null when the model gave none. */
  confidence: z.number().min(0).max(1).nullable(),
  summary: z.string(),
  treatment: z.array(z.string()),
  prevention: z.array(z.string()),
  sensorTips: z.array(scanSensorTip),
  conditions: scanConditions.nullable(),
  alternatives: z.array(scanAlternative),
  /** The model's own label, unchanged. */
  rawLabel: z.string().nullable(),
  model: z.object({ provider: z.string(), name: z.string() }),
  durationMs: z.number().int().nonnegative(),
});
export type ScanPublic = z.infer<typeof scanPublic>;

export const scanList = z.object({ items: z.array(scanPublic), nextCursor: z.string().nullable() });
export type ScanList = z.infer<typeof scanList>;

/** Is a disease model connected? The app shows a friendly banner when it isn't. */
export const scanServiceStatus = z.object({
  ready: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  minConfidence: z.number().min(0).max(1),
  message: z.string(),
});
export type ScanServiceStatus = z.infer<typeof scanServiceStatus>;

export const scanUploadRequest = z.object({ contentType: photoContentType });
export const scanUploadResponse = z.object({ photoId: z.string(), upload: signedUpload });
export type ScanUploadResponse = z.infer<typeof scanUploadResponse>;

export const createScanBody = z.object({
  photoId: z.string().min(1).max(200),
  /** Links the scan to a Xeno device so its sensors can add tips. */
  deviceId: objectId.nullable().optional(),
});
export type CreateScanBody = z.infer<typeof createScanBody>;

export const scanListQuery = z.object({
  deviceId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** ISO time of the last item of the previous page. */
  cursor: isoDate.optional(),
});
