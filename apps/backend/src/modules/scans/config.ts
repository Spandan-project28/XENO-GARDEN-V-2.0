/**
 * Plant-scan model configuration, from SCAN_* environment variables (apps/backend/.env).
 * Parsed on its own and never throws: a missing or broken model config only switches the scan
 * feature off ("model not connected"); the irrigation server always starts.
 * See docs/PLANT_SCAN.md for examples per API.
 */
import { z } from 'zod';

export const SCAN_PRESETS = ['generic', 'huggingface', 'roboflow', 'kindwise', 'xeno-ml'] as const;
export type ScanPreset = (typeof SCAN_PRESETS)[number];
export type RequestFormat = 'multipart' | 'json-base64' | 'raw' | 'form-base64';

/** Defaults per well-known API, so usually only URL + key are needed. */
export const PRESET_DEFAULTS: Record<
  ScanPreset,
  {
    auth: string;
    request: RequestFormat;
    imageField: string;
    resultsPath?: string;
    labelKey?: string;
    confidenceKey?: string;
    cropPath?: string;
    isPlantPath?: string;
    defaultUrl?: string;
    modelName: string;
  }
> = {
  generic: { auth: 'bearer', request: 'multipart', imageField: 'image', modelName: 'Plant disease model' },
  huggingface: { auth: 'bearer', request: 'raw', imageField: 'image', modelName: 'Hugging Face model' },
  roboflow: { auth: 'query:api_key', request: 'form-base64', imageField: 'image', modelName: 'Roboflow model' },
  kindwise: {
    auth: 'header:Api-Key',
    request: 'json-base64',
    imageField: 'images',
    resultsPath: 'result.disease.suggestions',
    labelKey: 'name',
    confidenceKey: 'probability',
    cropPath: 'result.crop.suggestions.0.name',
    isPlantPath: 'result.is_plant.binary',
    defaultUrl: 'https://crop.kindwise.com/api/v1/identification',
    modelName: 'crop.health (Kindwise)',
  },
  'xeno-ml': {
    auth: 'header:x-ml-key',
    request: 'multipart',
    imageField: 'image',
    defaultUrl: 'http://127.0.0.1:8000/v1/scan/predict',
    modelName: 'Xeno local model',
  },
};

const optional = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

const schema = z.object({
  SCAN_API_PRESET: optional.pipe(z.enum(SCAN_PRESETS).optional()).transform((v) => v ?? 'generic'),
  SCAN_API_URL: optional.pipe(z.url().optional()),
  SCAN_API_KEY: optional,
  /** bearer | header:<Name> | query:<param> | none */
  SCAN_API_AUTH: optional.pipe(z.string().regex(/^(bearer|none|header:[A-Za-z0-9-]+|query:[A-Za-z0-9_-]+)$/).optional()),
  SCAN_API_REQUEST: optional.pipe(z.enum(['multipart', 'json-base64', 'raw', 'form-base64']).optional()),
  SCAN_API_IMAGE_FIELD: optional,
  /** Extra fields sent with every request, as JSON, e.g. {"similar_images":false} */
  SCAN_API_BODY_EXTRA: optional,
  SCAN_API_RESULTS_PATH: optional,
  SCAN_API_LABEL_KEY: optional,
  SCAN_API_CONFIDENCE_KEY: optional,
  SCAN_API_CROP_PATH: optional,
  SCAN_API_IS_PLANT_PATH: optional,
  SCAN_API_MODEL_NAME: optional,
  SCAN_MIN_CONFIDENCE: optional.transform((v) => (v === undefined ? undefined : Number(v))).pipe(z.number().min(0).max(1).optional()),
  SCAN_TIMEOUT_MS: optional.transform((v) => (v === undefined ? undefined : Number(v))).pipe(z.number().int().min(1000).max(120_000).optional()),
});

export interface ScanConfig {
  /** False when no model is configured (or the config is invalid). */
  ready: boolean;
  /** Why it isn't ready, for logs and the app's banner. */
  problem: string | null;
  preset: ScanPreset;
  url: string | null;
  apiKey: string | null;
  auth: string;
  request: RequestFormat;
  imageField: string;
  bodyExtra: Record<string, unknown>;
  resultsPath: string | null;
  labelKey: string | null;
  confidenceKey: string | null;
  cropPath: string | null;
  isPlantPath: string | null;
  modelName: string;
  minConfidence: number;
  timeoutMs: number;
}

const NOT_CONNECTED = 'No disease model is connected yet. Add SCAN_API_URL (and SCAN_API_KEY) to apps/backend/.env.';

export function loadScanConfig(source: Record<string, string | undefined> = process.env): ScanConfig {
  const parsed = schema.safeParse(source);
  const off = (problem: string): ScanConfig => ({
    ready: false,
    problem,
    preset: 'generic',
    url: null,
    apiKey: null,
    auth: 'none',
    request: 'multipart',
    imageField: 'image',
    bodyExtra: {},
    resultsPath: null,
    labelKey: null,
    confidenceKey: null,
    cropPath: null,
    isPlantPath: null,
    modelName: 'none',
    minConfidence: 0.55,
    timeoutMs: 30_000,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return off(`Plant scan settings are invalid (${issue?.path.join('.')}: ${issue?.message}).`);
  }
  const e = parsed.data;
  const d = PRESET_DEFAULTS[e.SCAN_API_PRESET];
  let bodyExtra: Record<string, unknown> = {};
  if (e.SCAN_API_BODY_EXTRA) {
    try {
      const v: unknown = JSON.parse(e.SCAN_API_BODY_EXTRA);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      bodyExtra = v as Record<string, unknown>;
    } catch {
      return off('SCAN_API_BODY_EXTRA must be a JSON object, e.g. {"similar_images":false}.');
    }
  }
  const url = e.SCAN_API_URL ?? d.defaultUrl ?? null;
  // A preset with a default URL still needs to be chosen explicitly (generic has none).
  if (!url) return off(NOT_CONNECTED);
  const auth = e.SCAN_API_AUTH ?? (e.SCAN_API_KEY ? d.auth : 'none');
  const keyRequired = ['huggingface', 'roboflow', 'kindwise'].includes(e.SCAN_API_PRESET) || (auth !== 'none' && !!e.SCAN_API_AUTH);
  if (keyRequired && !e.SCAN_API_KEY) return off('SCAN_API_KEY is missing for the plant disease model.');
  return {
    ready: true,
    problem: null,
    preset: e.SCAN_API_PRESET,
    url,
    apiKey: e.SCAN_API_KEY ?? null,
    auth: e.SCAN_API_KEY ? auth : 'none',
    request: e.SCAN_API_REQUEST ?? d.request,
    imageField: e.SCAN_API_IMAGE_FIELD ?? d.imageField,
    bodyExtra,
    resultsPath: e.SCAN_API_RESULTS_PATH ?? d.resultsPath ?? null,
    labelKey: e.SCAN_API_LABEL_KEY ?? d.labelKey ?? null,
    confidenceKey: e.SCAN_API_CONFIDENCE_KEY ?? d.confidenceKey ?? null,
    cropPath: e.SCAN_API_CROP_PATH ?? d.cropPath ?? null,
    isPlantPath: e.SCAN_API_IS_PLANT_PATH ?? d.isPlantPath ?? null,
    modelName: e.SCAN_API_MODEL_NAME ?? d.modelName,
    minConfidence: e.SCAN_MIN_CONFIDENCE ?? 0.55,
    timeoutMs: e.SCAN_TIMEOUT_MS ?? 30_000,
  };
}
