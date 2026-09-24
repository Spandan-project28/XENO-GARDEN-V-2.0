import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../../src/db/connect.js';

let server: MongoMemoryServer | null = null;

/** Starts an in-memory MongoDB and connects mongoose to it. Returns the URI. */
export async function startMongo(): Promise<string> {
  server = await MongoMemoryServer.create();
  const uri = server.getUri('xg_test');
  await connectDb(uri);
  return uri;
}

export async function stopMongo() {
  await disconnectDb();
  await server?.stop();
  server = null;
}

/** Deletes all documents but keeps collections and indexes. */
export async function clearDb() {
  const cols = await mongoose.connection.db!.collections();
  for (const c of cols) {
    if (!c.collectionName.startsWith('system.')) await c.deleteMany({});
  }
}

export { mongoose };
