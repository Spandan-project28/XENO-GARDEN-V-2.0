import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    MONGO_URI: z.string().min(1, 'MONGO_URI is required (e.g. mongodb://localhost:27017/xeno_garden)'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(86400).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    /** Browser origins allowed by CORS. Native apps send no Origin and are unaffected. */
    CORS_ORIGINS: csv,

    /** Run an in-process MQTT broker (aedes). Devices authenticate against the database. */
    MQTT_EMBEDDED: bool.default(true),
    MQTT_EMBEDDED_PORT: z.coerce.number().int().min(0).max(65535).default(1883),
    /** External broker for the backend service account (used when MQTT_EMBEDDED=false). */
    MQTT_URL: z.string().optional(),
    MQTT_USERNAME: z.string().optional(),
    MQTT_PASSWORD: z.string().optional(),

    /** Broker address handed to devices at claim time (what the ESP32 connects to). */
    DEVICE_BROKER_HOST: z.string().min(1).default('localhost'),
    DEVICE_BROKER_PORT: z.coerce.number().int().min(1).max(65535).default(1883),
    DEVICE_BROKER_TLS: bool.default(false),

    /** Minutes of continuous low moisture before a LOW_MOISTURE alert opens. */
    ALERT_LOW_MOISTURE_MINUTES: z.coerce.number().int().min(0).max(1440).default(10),
    /** Missed telemetry intervals before a device is considered offline (in addition to LWT). */
    OFFLINE_AFTER_INTERVALS: z.coerce.number().int().min(2).max(100).default(6),

    /** Optional Expo access token for push (only needed with enhanced push security). */
    EXPO_ACCESS_TOKEN: z.string().optional(),
    PUSH_ENABLED: bool.default(true),

    /** Firmware release channel for OTA updates (all three or none). */
    FIRMWARE_LATEST_VERSION: z.string().max(32).optional(),
    FIRMWARE_LATEST_URL: z.url({ protocol: /^https$/ }).optional(),
    FIRMWARE_LATEST_SHA256: z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex SHA-256').optional(),

    /** Bearer token for GET /v1/metrics. Without it, metrics are only served outside production. */
    METRICS_TOKEN: z.string().min(16).optional(),

    /** Optional plant-health model service (services/ml). Rules are used when unset or failing. */
    ML_SERVICE_URL: z.string().url().optional(),
    ML_API_KEY: z.string().optional(),
    ML_MODEL_NAME: z.string().default('baseline'),

    /** Directory for uploaded plant photos in the local-disk storage driver. */
    UPLOAD_DIR: z.string().default('./uploads'),
    PUBLIC_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const fw = [env.FIRMWARE_LATEST_VERSION, env.FIRMWARE_LATEST_URL, env.FIRMWARE_LATEST_SHA256];
    if (fw.some(Boolean) && !fw.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIRMWARE_LATEST_URL'],
        message: 'Set FIRMWARE_LATEST_VERSION, FIRMWARE_LATEST_URL and FIRMWARE_LATEST_SHA256 together',
      });
    }
    if (!env.MQTT_EMBEDDED && !env.MQTT_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['MQTT_URL'],
        message: 'MQTT_URL is required when MQTT_EMBEDDED=false',
      });
    }
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET.includes('change-me')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'Set a real JWT_ACCESS_SECRET in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parses env vars and fails fast with a readable list of problems. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
