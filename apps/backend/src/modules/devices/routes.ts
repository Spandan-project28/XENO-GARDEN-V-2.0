import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  claimBody,
  claimResponse,
  devicePublic,
  idParams,
  okResponse,
  updateDeviceBody,
} from '@xeno/shared';

export const deviceRoutes: FastifyPluginAsyncZod = async (app) => {
  const { devices } = app.deps.services;
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['devices'], security: [{ bearer: [] }] };

  app.post(
    '/devices/claim',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { ...common, body: claimBody, response: { 201: claimResponse } },
    },
    async (req, reply) => reply.code(201).send(await devices.claim(req.userId, req.body, { requestHost: req.hostname })),
  );

  app.get(
    '/devices',
    { schema: { ...common, response: { 200: z.object({ items: z.array(devicePublic) }) } } },
    async (req) => ({ items: await devices.list(req.userId) }),
  );

  app.get(
    '/devices/:id',
    { schema: { ...common, params: idParams, response: { 200: devicePublic } } },
    async (req) => devices.get(req.userId, req.params.id),
  );

  app.patch(
    '/devices/:id',
    {
      schema: { ...common, params: idParams, body: updateDeviceBody, response: { 200: devicePublic } },
    },
    async (req) => devices.update(req.userId, req.params.id, req.body),
  );

  app.delete(
    '/devices/:id',
    { schema: { ...common, params: idParams, response: { 200: okResponse } } },
    async (req) => {
      await devices.remove(req.userId, req.params.id);
      return { ok: true as const };
    },
  );
};
