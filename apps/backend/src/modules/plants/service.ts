import type { PhotoUploadResponse, PlantBody, PlantPublic } from '@xeno/shared';
import { nanoid } from 'nanoid';
import { Types } from 'mongoose';
import { Device, HealthReport, Plant, type DeviceDoc, type PlantDoc } from '../../db/models.js';
import { AppError, notFound } from '../../lib/errors.js';
import { extensionFor, type ObjectStorage } from '../media/storage.js';

const UPLOAD_URL_TTL_SEC = 10 * 60;
const READ_URL_TTL_SEC = 24 * 3600;

export function createPlantService({ storage }: { storage: ObjectStorage }) {
  async function toPlantPublic(p: PlantDoc, base: string): Promise<PlantPublic> {
    const device = await Device.findOne({ plantId: p._id }, { _id: 1 }).lean<DeviceDoc>();
    return {
      id: p._id.toHexString(),
      name: p.name,
      species: p.species,
      notes: p.notes,
      // Stored as a storage key; clients always get a short-lived signed URL.
      photoUrl: p.photoUrl ? storage.createReadUrl(base, p.photoUrl, READ_URL_TTL_SEC) : null,
      deviceId: device ? device._id.toHexString() : null,
      createdAt: p.createdAt.toISOString(),
    };
  }

  async function owned(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound('Plant');
    const p = await Plant.findOne({ _id: id, ownerId: userId }).lean<PlantDoc>();
    if (!p) throw notFound('Plant');
    return p;
  }

  return {
    owned,
    toPublic: toPlantPublic,

    async list(userId: string, base: string) {
      const docs = await Plant.find({ ownerId: userId }).sort({ createdAt: 1 }).lean<PlantDoc[]>();
      return Promise.all(docs.map((d) => toPlantPublic(d, base)));
    },
    async create(userId: string, body: PlantBody, base: string) {
      const p = await Plant.create({ ownerId: userId, name: body.name, species: body.species ?? null, notes: body.notes ?? null });
      return toPlantPublic(p.toObject(), base);
    },
    async update(userId: string, id: string, body: Partial<PlantBody>, base: string) {
      await owned(userId, id);
      const $set: Record<string, unknown> = {};
      for (const k of ['name', 'species', 'notes'] as const) if (body[k] !== undefined) $set[k] = body[k];
      const p = await Plant.findByIdAndUpdate(id, { $set }, { returnDocument: 'after' }).lean<PlantDoc>();
      return toPlantPublic(p!, base);
    },
    async remove(userId: string, id: string) {
      await owned(userId, id);
      await Promise.all([
        Plant.deleteOne({ _id: id }),
        Device.updateMany({ plantId: id }, { $set: { plantId: null } }),
        HealthReport.deleteMany({ plantId: id }),
      ]);
    },

    /** Step 1 of a photo upload: a signed PUT URL valid for 10 minutes. */
    async createPhotoUpload(userId: string, id: string, contentType: string, base: string): Promise<PhotoUploadResponse> {
      await owned(userId, id);
      const key = `plants/${id}/${nanoid(16).toLowerCase().replace(/[^a-z0-9]/g, 'x')}.${extensionFor(contentType)}`;
      return { photoId: key, upload: storage.createUploadUrl(base, key, contentType, UPLOAD_URL_TTL_SEC) as PhotoUploadResponse['upload'] };
    },

    /** Step 2: attach the uploaded photo to the plant. */
    async attachPhoto(userId: string, id: string, photoId: string) {
      await owned(userId, id);
      if (!photoId.startsWith(`plants/${id}/`)) throw new AppError('FORBIDDEN', 'This photo belongs to another plant');
      if (!(await storage.exists(photoId))) throw new AppError('BAD_REQUEST', 'Upload the photo before attaching it');
      const p = await Plant.findByIdAndUpdate(id, { $set: { photoUrl: photoId } }, { returnDocument: 'after' }).lean<PlantDoc>();
      return p!;
    },

    readUrl: (base: string, key: string, ttlSec = 3600) => storage.createReadUrl(base, key, ttlSec),
  };
}
export type PlantService = ReturnType<typeof createPlantService>;
