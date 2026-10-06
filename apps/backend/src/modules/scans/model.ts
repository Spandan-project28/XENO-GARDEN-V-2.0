/** Stored plant scans (own collection, separate from the irrigation data). */
import { model, Schema, type Types } from 'mongoose';
import type {
  ScanAlternative,
  ScanCategory,
  ScanConditions,
  ScanSensorTip,
  ScanSeverity,
  ScanStatusKind,
} from '@xeno/shared';

export interface ScanDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  deviceId: Types.ObjectId | null;
  deviceName: string | null;
  /** Storage key of the photo (clients get short-lived signed URLs). */
  imageKey: string;
  status: ScanStatusKind;
  category: ScanCategory;
  severity: ScanSeverity;
  title: string;
  crop: string | null;
  condition: string | null;
  confidence: number | null;
  summary: string;
  treatment: string[];
  prevention: string[];
  sensorTips: ScanSensorTip[];
  conditions: ScanConditions | null;
  alternatives: ScanAlternative[];
  rawLabel: string | null;
  model: { provider: string; name: string };
  durationMs: number;
  createdAt: Date;
}

const scanSchema = new Schema<ScanDoc>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },
    deviceName: { type: String, default: null },
    imageKey: { type: String, required: true },
    status: { type: String, required: true },
    category: { type: String, required: true },
    severity: { type: String, required: true },
    title: { type: String, required: true },
    crop: { type: String, default: null },
    condition: { type: String, default: null },
    confidence: { type: Number, default: null },
    summary: { type: String, required: true },
    treatment: { type: [String], default: [] },
    prevention: { type: [String], default: [] },
    sensorTips: { type: Schema.Types.Mixed, default: [] },
    conditions: { type: Schema.Types.Mixed, default: null },
    alternatives: { type: Schema.Types.Mixed, default: [] },
    rawLabel: { type: String, default: null },
    model: { provider: { type: String, required: true }, name: { type: String, required: true } },
    durationMs: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
scanSchema.index({ ownerId: 1, createdAt: -1 });
scanSchema.index({ ownerId: 1, deviceId: 1, createdAt: -1 });

export const Scan = model<ScanDoc>('PlantScan', scanSchema, 'plant_scans');
