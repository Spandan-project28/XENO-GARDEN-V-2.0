import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  deviceCommandBody,
  devicePublic,
  deviceSettingsPatch,
  firmwareStatus,
  idParams,
  pumpCommandBody,
  pumpCommandResponse,
  setModeBody,
} from '@xeno/shared';

export const controlRoutes: FastifyPluginAsyncZod = async (app) => {
  const { control } = app.deps.services;
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['control'], security: [{ bearer: [] }], params: idParams };

  app.put(
    '/devices/:id/settings',
    { schema: { ...common, body: deviceSettingsPatch, response: { 200: devicePublic } } },
    async (req) => control.updateSettings(req.userId, req.params.id, req.body),
  );

  app.put(
    '/devices/:id/mode',
    { schema: { ...common, body: setModeBody, response: { 200: devicePublic } } },
    async (req) => control.setMode(req.userId, req.params.id, req.body.mode),
  );

  app.post(
    '/devices/:id/pump',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { ...common, body: pumpCommandBody, response: { 200: pumpCommandResponse } },
    },
    async (req) => control.pump(req.userId, req.params.id, req.body),
  );

  app.post(
    '/devices/:id/commands',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { ...common, body: deviceCommandBody, response: { 200: z.object({ cmdId: z.string() }) } },
    },
    async (req) => control.sendCommand(req.userId, req.params.id, req.body.type),
  );

  app.get(
    '/devices/:id/firmware',
    { schema: { ...common, response: { 200: firmwareStatus } } },
    async (req) => control.firmwareStatus(req.userId, req.params.id),
  );

  app.post(
    '/devices/:id/firmware/update',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { ...common, response: { 200: z.object({ cmdId: z.string() }) } },
    },
    async (req) => control.updateFirmware(req.userId, req.params.id),
  );
};
