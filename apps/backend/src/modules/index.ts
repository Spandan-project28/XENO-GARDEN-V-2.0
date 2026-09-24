import type { FastifyPluginAsync } from 'fastify';
import { authRoutes } from './auth/routes.js';
import { controlRoutes } from './control/routes.js';
import { deviceRoutes } from './devices/routes.js';

/**
 * Registers every feature module under /v1. To add a feature: create `modules/<name>/routes.ts`
 * exporting a plugin, then register it here.
 */
export const registerModules: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes);
  await app.register(deviceRoutes);
  await app.register(controlRoutes);
};
