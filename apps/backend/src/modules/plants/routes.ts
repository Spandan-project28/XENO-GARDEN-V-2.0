import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { healthReport, healthResponse, idParams, okResponse, plantBody, plantPublic } from '@xeno/shared';

export const plantRoutes: FastifyPluginAsyncZod = async (app) => {
  const { plants, insights } = app.deps.services;
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['plants'], security: [{ bearer: [] }] };

  app.get(
    '/plants',
    { schema: { ...common, response: { 200: z.object({ items: z.array(plantPublic) }) } } },
    async (req) => ({ items: await plants.list(req.userId) }),
  );

  app.post(
    '/plants',
    { schema: { ...common, body: plantBody, response: { 201: plantPublic } } },
    async (req, reply) => reply.code(201).send(await plants.create(req.userId, req.body)),
  );

  app.patch(
    '/plants/:id',
    { schema: { ...common, params: idParams, body: plantBody.partial(), response: { 200: plantPublic } } },
    async (req) => plants.update(req.userId, req.params.id, req.body),
  );

  app.delete(
    '/plants/:id',
    { schema: { ...common, params: idParams, response: { 200: okResponse } } },
    async (req) => {
      await plants.remove(req.userId, req.params.id);
      return { ok: true as const };
    },
  );

  app.get(
    '/plants/:id/health',
    { schema: { ...common, params: idParams, response: { 200: healthResponse } } },
    async (req) => insights.get(req.userId, req.params.id),
  );

  app.post(
    '/plants/:id/health/run',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { ...common, params: idParams, response: { 200: healthReport } },
    },
    async (req) => insights.run(req.userId, req.params.id),
  );
};
