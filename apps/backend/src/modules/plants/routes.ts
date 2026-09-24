import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  attachPhotoBody,
  attachPhotoResponse,
  healthReport,
  healthResponse,
  idParams,
  okResponse,
  photoUploadRequest,
  photoUploadResponse,
  plantBody,
  plantPublic,
} from '@xeno/shared';

export const plantRoutes: FastifyPluginAsyncZod = async (app) => {
  const { plants, insights } = app.deps.services;
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['plants'], security: [{ bearer: [] }] };
  /** Public origin as the client sees it (works on any network / behind a proxy with PUBLIC_URL). */
  const base = (req: FastifyRequest) => app.deps.env.PUBLIC_URL?.replace(/\/+$/, '') ?? `${req.protocol}://${req.host}`;

  app.get(
    '/plants',
    { schema: { ...common, response: { 200: z.object({ items: z.array(plantPublic) }) } } },
    async (req) => ({ items: await plants.list(req.userId, base(req)) }),
  );

  app.post(
    '/plants',
    { schema: { ...common, body: plantBody, response: { 201: plantPublic } } },
    async (req, reply) => reply.code(201).send(await plants.create(req.userId, req.body, base(req))),
  );

  app.patch(
    '/plants/:id',
    { schema: { ...common, params: idParams, body: plantBody.partial(), response: { 200: plantPublic } } },
    async (req) => plants.update(req.userId, req.params.id, req.body, base(req)),
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

  app.post(
    '/plants/:id/photos/upload-url',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { ...common, params: idParams, body: photoUploadRequest, response: { 200: photoUploadResponse } },
    },
    async (req) => plants.createPhotoUpload(req.userId, req.params.id, req.body.contentType, base(req)),
  );

  app.post(
    '/plants/:id/photos',
    { schema: { ...common, params: idParams, body: attachPhotoBody, response: { 200: attachPhotoResponse } } },
    async (req) => {
      const doc = await plants.attachPhoto(req.userId, req.params.id, req.body.photoId);
      const report = req.body.analyze
        ? await insights.run(req.userId, req.params.id, plants.readUrl(base(req), req.body.photoId))
        : null;
      return { plant: await plants.toPublic(doc, base(req)), report };
    },
  );
};
