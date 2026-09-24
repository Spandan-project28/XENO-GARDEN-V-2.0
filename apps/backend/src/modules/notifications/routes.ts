import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notificationPrefs, okResponse, pushTokenBody } from '@xeno/shared';

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  const { notifications } = app.deps.services;
  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['notifications'], security: [{ bearer: [] }] };

  app.post(
    '/me/push-tokens',
    { schema: { ...common, body: pushTokenBody, response: { 200: okResponse } } },
    async (req) => {
      await notifications.registerToken(req.userId, req.body);
      return { ok: true as const };
    },
  );

  app.delete(
    '/me/push-tokens',
    { schema: { ...common, body: z.object({ token: z.string().min(1).max(300) }), response: { 200: okResponse } } },
    async (req) => {
      await notifications.removeToken(req.userId, req.body.token);
      return { ok: true as const };
    },
  );

  app.get(
    '/me/notification-prefs',
    { schema: { ...common, response: { 200: notificationPrefs } } },
    async (req) => notifications.getPrefs(req.userId),
  );

  app.put(
    '/me/notification-prefs',
    { schema: { ...common, body: notificationPrefs, response: { 200: notificationPrefs } } },
    async (req) => notifications.setPrefs(req.userId, req.body),
  );
};
