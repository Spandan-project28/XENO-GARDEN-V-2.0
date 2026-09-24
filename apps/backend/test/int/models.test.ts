import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Alert, RAW_READING_TTL_SEC, Reading, User } from '../../src/db/models.js';
import { syncAllIndexes } from '../../src/db/models.js';
import { clearDb, mongoose, startMongo, stopMongo } from '../helpers/mongo.js';

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(clearDb);

const alertBase = () => ({
  deviceId: new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'),
  ownerId: new Types.ObjectId(),
  type: 'LOW_MOISTURE' as const,
  severity: 'warning' as const,
  message: 'Soil is dry',
  firstSeenAt: new Date(),
  lastSeenAt: new Date(),
});

describe('models & indexes', () => {
  it('readings is a time-series collection with 30-day TTL', async () => {
    const [info] = await mongoose.connection.db!.listCollections({ name: 'readings' }).toArray();
    expect(info?.type).toBe('timeseries');
    const opts = (info as unknown as { options: Record<string, unknown> }).options;
    expect(opts.timeseries).toMatchObject({ timeField: 'ts', metaField: 'deviceId' });
    expect(opts.expireAfterSeconds).toBe(RAW_READING_TTL_SEC);
  });

  it('accepts readings with null (faulty) sensor values', async () => {
    await Reading.create({
      ts: new Date(),
      deviceId: new Types.ObjectId(),
      soilMoisture: null,
      soilRaw: null,
      temperature: 21,
      humidity: null,
      rain: false,
      pump: false,
    });
    expect(await Reading.countDocuments()).toBe(1);
  });

  it('allows only one active alert per device+type', async () => {
    await Alert.create(alertBase());
    await expect(Alert.create(alertBase())).rejects.toMatchObject({ code: 11000 });
  });

  it('allows a new alert once the previous one is resolved', async () => {
    const a = await Alert.create(alertBase());
    await Alert.updateOne({ _id: a._id }, { status: 'resolved', active: false, resolvedAt: new Date() });
    await Alert.create(alertBase());
    expect(await Alert.countDocuments()).toBe(2);
  });

  it('enforces unique user emails (case-insensitive via lowercase)', async () => {
    await User.create({ email: 'A@b.co', passwordHash: 'x', name: 'A' });
    await expect(User.create({ email: 'a@b.co', passwordHash: 'x', name: 'B' })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('index sync is idempotent', async () => {
    await expect(syncAllIndexes()).resolves.toBeUndefined();
  });
});
