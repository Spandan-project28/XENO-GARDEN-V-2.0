import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponse = z.object({
  ok: z.boolean(),
  version: z.string(),
  uptimeSec: z.number(),
  time: z.string(),
  checks: z.object({ db: z.boolean(), mqtt: z.boolean() }),
  devicesConnected: z.number().int(),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/metrics', { schema: { hide: true }, config: { rateLimit: false } }, async (req, reply) => {
    const { env, metrics } = app.deps;
    const allowed = env.METRICS_TOKEN
      ? req.headers.authorization === `Bearer ${env.METRICS_TOKEN}`
      : env.NODE_ENV !== 'production';
    if (!allowed) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    return reply.header('content-type', 'text/plain; version=0.0.4').send(metrics.registry.render());
  });

  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness + dependency status',
        response: { 200: healthResponse, 503: healthResponse },
      },
      config: { rateLimit: false },
    },
    async (_req, reply) => {
      const { status } = app.deps;
      const checks = { db: status.db(), mqtt: status.mqtt() };
      const ok = checks.db && checks.mqtt;
      return reply.code(ok ? 200 : 503).send({
        ok,
        version: '2.0.0',
        uptimeSec: Math.round(process.uptime()),
        time: app.deps.now().toISOString(),
        checks,
        devicesConnected: status.devicesConnected(),
      });
    },
  );
};
