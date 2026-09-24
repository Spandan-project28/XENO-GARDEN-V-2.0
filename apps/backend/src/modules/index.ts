import type { FastifyPluginAsync } from 'fastify';

/**
 * Registers every feature module under /v1. To add a feature: create `modules/<name>/routes.ts`
 * exporting a plugin, then register it here.
 */
export const registerModules: FastifyPluginAsync = async (_app) => {
  // modules are added in later phases
};
