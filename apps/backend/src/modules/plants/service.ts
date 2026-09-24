import type { PlantBody, PlantPublic } from '@xeno/shared';
import { Types } from 'mongoose';
import { Device, HealthReport, Plant, type DeviceDoc, type PlantDoc } from '../../db/models.js';
import { notFound } from '../../lib/errors.js';

async function toPlantPublic(p: PlantDoc): Promise<PlantPublic> {
  const device = await Device.findOne({ plantId: p._id }, { _id: 1 }).lean<DeviceDoc>();
  return {
    id: p._id.toHexString(),
    name: p.name,
    species: p.species,
    notes: p.notes,
    photoUrl: p.photoUrl,
    deviceId: device ? device._id.toHexString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

export function createPlantService() {
  async function owned(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound('Plant');
    const p = await Plant.findOne({ _id: id, ownerId: userId }).lean<PlantDoc>();
    if (!p) throw notFound('Plant');
    return p;
  }

  return {
    async list(userId: string) {
      const docs = await Plant.find({ ownerId: userId }).sort({ createdAt: 1 }).lean<PlantDoc[]>();
      return Promise.all(docs.map(toPlantPublic));
    },
    async create(userId: string, body: PlantBody) {
      const p = await Plant.create({ ownerId: userId, name: body.name, species: body.species ?? null, notes: body.notes ?? null });
      return toPlantPublic(p.toObject());
    },
    async update(userId: string, id: string, body: Partial<PlantBody>) {
      await owned(userId, id);
      const $set: Record<string, unknown> = {};
      for (const k of ['name', 'species', 'notes'] as const) if (body[k] !== undefined) $set[k] = body[k];
      const p = await Plant.findByIdAndUpdate(id, { $set }, { returnDocument: 'after' }).lean<PlantDoc>();
      return toPlantPublic(p!);
    },
    async remove(userId: string, id: string) {
      await owned(userId, id);
      await Promise.all([
        Plant.deleteOne({ _id: id }),
        Device.updateMany({ plantId: id }, { $set: { plantId: null } }),
        HealthReport.deleteMany({ plantId: id }),
      ]);
    },
  };
}
export type PlantService = ReturnType<typeof createPlantService>;
