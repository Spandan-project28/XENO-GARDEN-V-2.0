import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParams, pumpEvent, pumpEventsQuery, readingsQuery, readingsResponse } from '@xeno/shared';

export const telemetryRoutes: FastifyPluginAsyncZod = async (app) => {
  const { devices, readings, pumpEvents } = app.deps.services;
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['telemetry'], security: [{ bearer: [] }], params: idParams };

  app.get(
    '/devices/:id/readings',
    { schema: { ...common, querystring: readingsQuery, response: { 200: readingsResponse } } },
    async (req) => {
      await devices.getOwned(req.userId, req.params.id);
      return readings.query(req.params.id, req.query, app.deps.now());
    },
  );

  app.get(
    '/devices/:id/pump-events',
    {
      schema: {
        ...common,
        querystring: pumpEventsQuery,
        response: { 200: z.object({ items: z.array(pumpEvent) }) },
      },
    },
    async (req) => {
      await devices.getOwned(req.userId, req.params.id);
      const items = await pumpEvents.list(req.params.id, new Date(req.query.from), new Date(req.query.to));
      return { items };
    },
  );
};
