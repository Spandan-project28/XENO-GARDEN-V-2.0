/**
 * All Mongoose models (plan §6). Validation of external input happens with the shared Zod
 * schemas at the edges; these schemas define storage shape and indexes.
 */
import mongoose, { Schema, type Types } from 'mongoose';
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  type AlertSeverity,
  type AlertStatus,
  type AlertType,
  type DesiredState,
  type HealthFinding,
  type HealthStatus,
  type ReportedState,
} from '@xeno/shared';

const { model } = mongoose;

// ── users ────────────────────────────────────────────────────────────────────
export interface PushTokenDoc {
  token: string;
  platform: 'ios' | 'android' | 'web';
  updatedAt: Date;
}
export interface UserDoc {
  _id: Types.ObjectId;
  /** Null for guest accounts (ADR-016). */
  email: string | null;
  /** Null for guest accounts: they authenticate only with their refresh token. */
  passwordHash: string | null;
  name: string;
  guest: boolean;
  pushTokens: PushTokenDoc[];
  notificationPrefs: { enabled: boolean; types: Record<string, boolean> };
  failedLogins: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, default: null, lowercase: true, trim: true },
    passwordHash: { type: String, default: null },
    name: { type: String, required: true, trim: true },
    guest: { type: Boolean, default: false },
    pushTokens: {
      type: [
        new Schema<PushTokenDoc>(
          {
            token: { type: String, required: true },
            platform: { type: String, enum: ['ios', 'android', 'web'], required: true },
            updatedAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    notificationPrefs: {
      enabled: { type: Boolean, default: true },
      types: { type: Schema.Types.Mixed, default: {} },
    },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
// Unique among accounts that have an email; any number of guests (email: null).
userSchema.index(
  { email: 1 },
  { unique: true, name: 'email_unique', partialFilterExpression: { email: { $type: 'string' } } },
);
userSchema.index({ 'pushTokens.token': 1 });
export const User = model<UserDoc>('User', userSchema);

// ── refresh tokens ───────────────────────────────────────────────────────────
export interface RefreshTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  /** All tokens descended from one login share a family; reuse of a rotated token revokes it. */
  family: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedAt: Date | null;
  createdAt: Date;
}
const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshToken = model<RefreshTokenDoc>('RefreshToken', refreshTokenSchema);

// ── devices ──────────────────────────────────────────────────────────────────
export interface LatestDoc {
  ts: Date;
  soilMoisture: number | null;
  temperature: number | null;
  humidity: number | null;
  rain: boolean;
  pump: boolean;
}
export interface DeviceDoc {
  _id: Types.ObjectId;
  hardwareId: string;
  ownerId: Types.ObjectId;
  name: string;
  plantId: Types.ObjectId | null;
  claimCodeHash: string;
  claimedAt: Date;
  mqttPasswordHash: string;
  firmwareVersion: string | null;
  online: boolean;
  lastSeenAt: Date | null;
  desired: DesiredState;
  reported: (ReportedState & { at: Date }) | null;
  latest: LatestDoc | null;
  createdAt: Date;
  updatedAt: Date;
}
const deviceSchema = new Schema<DeviceDoc>(
  {
    hardwareId: { type: String, required: true, unique: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    plantId: { type: Schema.Types.ObjectId, ref: 'Plant', default: null },
    claimCodeHash: { type: String, required: true },
    claimedAt: { type: Date, required: true },
    mqttPasswordHash: { type: String, required: true },
    firmwareVersion: { type: String, default: null },
    online: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
    desired: { type: Schema.Types.Mixed, required: true },
    reported: { type: Schema.Types.Mixed, default: null },
    latest: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false },
);
deviceSchema.index({ online: 1, lastSeenAt: 1 });
export const Device = model<DeviceDoc>('Device', deviceSchema);

// ── readings (time-series, raw, 30 days) ─────────────────────────────────────
export const RAW_READING_TTL_SEC = 30 * 24 * 3600;
export interface ReadingDoc {
  ts: Date;
  deviceId: Types.ObjectId;
  soilMoisture: number | null;
  soilRaw: number | null;
  temperature: number | null;
  humidity: number | null;
  rain: boolean;
  pump: boolean;
}
const readingSchema = new Schema<ReadingDoc>(
  {
    ts: { type: Date, required: true },
    deviceId: { type: Schema.Types.ObjectId, required: true },
    soilMoisture: { type: Number, default: null },
    soilRaw: { type: Number, default: null },
    temperature: { type: Number, default: null },
    humidity: { type: Number, default: null },
    rain: { type: Boolean, required: true },
    pump: { type: Boolean, required: true },
  },
  {
    timeseries: { timeField: 'ts', metaField: 'deviceId', granularity: 'seconds' },
    expireAfterSeconds: RAW_READING_TTL_SEC,
    versionKey: false,
    autoCreate: true,
  },
);
readingSchema.index({ deviceId: 1, ts: -1 });
export const Reading = model<ReadingDoc>('Reading', readingSchema, 'readings');

// ── hourly rollups (kept forever) ────────────────────────────────────────────
export interface ReadingHourlyDoc {
  _id: Types.ObjectId;
  deviceId: Types.ObjectId;
  hour: Date;
  samples: number;
  soilAvg: number | null;
  soilMin: number | null;
  soilMax: number | null;
  tempAvg: number | null;
  humidityAvg: number | null;
  rainRatio: number;
  pumpRatio: number;
}
const readingHourlySchema = new Schema<ReadingHourlyDoc>(
  {
    deviceId: { type: Schema.Types.ObjectId, required: true },
    hour: { type: Date, required: true },
    samples: { type: Number, required: true },
    soilAvg: { type: Number, default: null },
    soilMin: { type: Number, default: null },
    soilMax: { type: Number, default: null },
    tempAvg: { type: Number, default: null },
    humidityAvg: { type: Number, default: null },
    rainRatio: { type: Number, required: true },
    pumpRatio: { type: Number, required: true },
  },
  { versionKey: false },
);
readingHourlySchema.index({ deviceId: 1, hour: 1 }, { unique: true });
export const ReadingHourly = model<ReadingHourlyDoc>(
  'ReadingHourly',
  readingHourlySchema,
  'readings_hourly',
);

// ── pump events ──────────────────────────────────────────────────────────────
export interface PumpEventDoc {
  _id: Types.ObjectId;
  deviceId: Types.ObjectId;
  source: 'auto' | 'manual' | 'safety';
  reason: string;
  stopReason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
}
const pumpEventSchema = new Schema<PumpEventDoc>(
  {
    deviceId: { type: Schema.Types.ObjectId, required: true },
    source: { type: String, enum: ['auto', 'manual', 'safety'], required: true },
    reason: { type: String, required: true },
    stopReason: { type: String, default: null },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    durationSec: { type: Number, default: null },
  },
  { versionKey: false },
);
pumpEventSchema.index({ deviceId: 1, startedAt: -1 });
export const PumpEvent = model<PumpEventDoc>('PumpEvent', pumpEventSchema, 'pump_events');

// ── alerts ───────────────────────────────────────────────────────────────────
export interface AlertDoc {
  _id: Types.ObjectId;
  deviceId: Types.ObjectId;
  ownerId: Types.ObjectId;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  /** true while not resolved — backs the "one active alert per (device, type)" unique index. */
  active: boolean;
  message: string;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  lastNotifiedAt: Date | null;
  context: Record<string, unknown>;
}
const alertSchema = new Schema<AlertDoc>(
  {
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ALERT_TYPES, required: true },
    severity: { type: String, enum: ALERT_SEVERITIES, required: true },
    status: { type: String, enum: ALERT_STATUSES, required: true, default: 'open' },
    active: { type: Boolean, required: true, default: true },
    message: { type: String, required: true },
    count: { type: Number, required: true, default: 1 },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    lastNotifiedAt: { type: Date, default: null },
    context: { type: Schema.Types.Mixed, default: {} },
  },
  { versionKey: false, minimize: false },
);
alertSchema.index(
  { deviceId: 1, type: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'one_active_alert_per_type' },
);
alertSchema.index({ ownerId: 1, lastSeenAt: -1, _id: -1 });
export const Alert = model<AlertDoc>('Alert', alertSchema);

// ── plants & health ──────────────────────────────────────────────────────────
export interface PlantDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  species: string | null;
  notes: string | null;
  photoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
const plantSchema = new Schema<PlantDoc>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    species: { type: String, default: null },
    notes: { type: String, default: null },
    photoUrl: { type: String, default: null },
  },
  { timestamps: true },
);
export const Plant = model<PlantDoc>('Plant', plantSchema);

export interface HealthReportDoc {
  _id: Types.ObjectId;
  plantId: Types.ObjectId;
  ownerId: Types.ObjectId;
  deviceId: Types.ObjectId | null;
  provider: string;
  modelVersion: string;
  score: number | null;
  status: HealthStatus;
  summary: string;
  findings: HealthFinding[];
  window: { from: Date; to: Date };
  imageUrl: string | null;
  createdAt: Date;
}
const healthReportSchema = new Schema<HealthReportDoc>(
  {
    plantId: { type: Schema.Types.ObjectId, ref: 'Plant', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },
    provider: { type: String, required: true },
    modelVersion: { type: String, required: true },
    score: { type: Number, default: null },
    status: { type: String, required: true },
    summary: { type: String, required: true },
    findings: { type: Schema.Types.Mixed, default: [] },
    window: { from: { type: Date, required: true }, to: { type: Date, required: true } },
    imageUrl: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
healthReportSchema.index({ plantId: 1, createdAt: -1 });
export const HealthReport = model<HealthReportDoc>('HealthReport', healthReportSchema, 'health_reports');

export const allModels = [
  User,
  RefreshToken,
  Device,
  Reading,
  ReadingHourly,
  PumpEvent,
  Alert,
  Plant,
  HealthReport,
] as const;

/** Creates collections (incl. the time-series one) and indexes. Safe to run on every boot. */
export async function syncAllIndexes() {
  for (const m of allModels) {
    await m.createCollection().catch((err: { codeName?: string }) => {
      if (err.codeName !== 'NamespaceExists') throw err;
    });
    await m.syncIndexes();
  }
}
