import type { CreateScanBody, DevicePublic, ScanPublic, ScanServiceStatus, ScanUploadResponse } from '@xeno/shared';
import { nanoid } from 'nanoid';
import { Types } from 'mongoose';
import type { AppLogger } from '../../lib/logger.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { DeviceService } from '../devices/service.js';
import { extensionFor, sniffImage, type LocalDiskStorage } from '../media/storage.js';
import { gardenConditions, interpret, sensorTips } from './advice.js';
import type { ScanConfig } from './config.js';
import { ModelError, type DiseaseDetector } from './detector.js';
import { Scan, type ScanDoc } from './model.js';

const UPLOAD_URL_TTL_SEC = 10 * 60;
const READ_URL_TTL_SEC = 24 * 3600;

export interface ScanServiceDeps {
  config: ScanConfig;
  detector: DiseaseDetector;
  storage: LocalDiskStorage;
  devices: DeviceService;
  log: AppLogger;
  now: () => Date;
}

export function createScanService({ config, detector, storage, devices, log, now }: ScanServiceDeps) {
  const prefix = (userId: string) => `scans/${userId}/`;

  function toPublic(d: ScanDoc, base: string): ScanPublic {
    return {
      id: d._id.toHexString(),
      createdAt: d.createdAt.toISOString(),
      deviceId: d.deviceId ? d.deviceId.toHexString() : null,
      deviceName: d.deviceName,
      imageUrl: storage.createReadUrl(base, d.imageKey, READ_URL_TTL_SEC),
      status: d.status,
      category: d.category,
      severity: d.severity,
      title: d.title,
      crop: d.crop,
      condition: d.condition,
      confidence: d.confidence,
      summary: d.summary,
      treatment: d.treatment,
      prevention: d.prevention,
      sensorTips: d.sensorTips,
      conditions: d.conditions,
      alternatives: d.alternatives,
      rawLabel: d.rawLabel,
      model: d.model,
      durationMs: d.durationMs,
    };
  }

  async function owned(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound('Scan');
    const d = await Scan.findOne({ _id: id, ownerId: userId }).lean<ScanDoc>();
    if (!d) throw notFound('Scan');
    return d;
  }

  return {
    status(): ScanServiceStatus {
      return {
        ready: config.ready,
        provider: config.ready ? config.preset : null,
        model: config.ready ? config.modelName : null,
        minConfidence: config.minConfidence,
        message: config.ready ? `Connected to ${config.modelName}.` : (config.problem ?? 'No disease model is connected yet.'),
      };
    },

    async createUpload(userId: string, contentType: string, base: string): Promise<ScanUploadResponse> {
      const key = `${prefix(userId)}${nanoid(16).toLowerCase().replace(/[^a-z0-9]/g, 'x')}.${extensionFor(contentType)}`;
      return { photoId: key, upload: storage.createUploadUrl(base, key, contentType, UPLOAD_URL_TTL_SEC) as ScanUploadResponse['upload'] };
    },

    async create(userId: string, body: CreateScanBody, base: string): Promise<ScanPublic> {
      if (!config.ready) throw new AppError('SCAN_UNAVAILABLE', config.problem ?? 'No disease model is connected yet.');
      if (!body.photoId.startsWith(prefix(userId))) throw new AppError('FORBIDDEN', 'This photo belongs to someone else');
      if (!(await storage.exists(body.photoId))) throw new AppError('BAD_REQUEST', 'Upload the photo before scanning it');
      const device: DevicePublic | null = body.deviceId ? await devices.get(userId, body.deviceId) : null;

      const bytes = await storage.read(body.photoId);
      const contentType = sniffImage(bytes) ?? 'image/jpeg';
      const started = Date.now();
      let detection;
      try {
        detection = await detector.detect({ bytes, contentType });
      } catch (err) {
        if (err instanceof ModelError) {
          log.warn({ detail: err.detail, model: config.modelName }, `plant scan failed: ${err.message}`);
          throw new AppError('SCAN_FAILED', err.message);
        }
        throw err;
      }
      const durationMs = Date.now() - started;
      const result = interpret(detection, config.minConfidence);
      const doc = await Scan.create({
        ownerId: new Types.ObjectId(userId),
        deviceId: device ? new Types.ObjectId(device.id) : null,
        deviceName: device?.name ?? null,
        imageKey: body.photoId,
        ...result,
        sensorTips: sensorTips(result.category, result.status, device, now()),
        conditions: gardenConditions(device),
        model: { provider: config.preset, name: detection.modelName },
        durationMs,
      });
      return toPublic(doc.toObject(), base);
    },

    async list(userId: string, q: { deviceId?: string; limit: number; cursor?: string }, base: string) {
      const filter: Record<string, unknown> = { ownerId: userId };
      if (q.deviceId) filter.deviceId = q.deviceId;
      if (q.cursor) filter.createdAt = { $lt: new Date(q.cursor) };
      const docs = await Scan.find(filter).sort({ createdAt: -1 }).limit(q.limit + 1).lean<ScanDoc[]>();
      const page = docs.slice(0, q.limit);
      return {
        items: page.map((d) => toPublic(d, base)),
        nextCursor: docs.length > q.limit ? page[page.length - 1]!.createdAt.toISOString() : null,
      };
    },

    async get(userId: string, id: string, base: string) {
      return toPublic(await owned(userId, id), base);
    },

    async remove(userId: string, id: string) {
      await owned(userId, id);
      await Scan.deleteOne({ _id: id });
    },
  };
}
export type ScanService = ReturnType<typeof createScanService>;
