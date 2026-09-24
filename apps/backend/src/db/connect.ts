import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { syncAllIndexes } from './models.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri: string, log?: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  mongoose.connection.on('disconnected', () => log?.warn('mongo disconnected'));
  mongoose.connection.on('reconnected', () => log?.info('mongo reconnected'));
  mongoose.connection.on('error', (err) => log?.error({ err }, 'mongo error'));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: false });
  await syncAllIndexes();
  log?.info({ db: mongoose.connection.name }, 'mongo connected');
  return mongoose.connection;
}

export const isDbConnected = () => mongoose.connection.readyState === 1;

export async function disconnectDb() {
  await mongoose.disconnect();
}
