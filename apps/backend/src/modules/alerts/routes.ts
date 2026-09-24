import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { alertCounts, alertPublic, alertsQuery, idParams, paginated } from '@xeno/shared';

export const alertRoutes: FastifyPluginAsyncZod = async (app) => {
  const { alerts } = app.deps.services;
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['alerts'], security: [{ bearer: [] }] };

  app.get(
    '/alerts',
    { schema: { ...common, querystring: alertsQuery, response: { 200: paginated(alertPublic) } } },
    async (req) => alerts.list(req.userId, req.query),
  );

  app.get(
    '/alerts/counts',
    { schema: { ...common, response: { 200: alertCounts } } },
    async (req) => alerts.counts(req.userId),
  );

  app.post(
    '/alerts/:id/ack',
    { schema: { ...common, params: idParams, response: { 200: alertPublic } } },
    async (req) => alerts.setStatus(req.userId, req.params.id, 'acknowledged', app.deps.now()),
  );

  app.post(
    '/alerts/:id/resolve',
    { schema: { ...common, params: idParams, response: { 200: alertPublic } } },
    async (req) => alerts.setStatus(req.userId, req.params.id, 'resolved', app.deps.now()),
  );
};
