import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  authResponse,
  authTokens,
  loginBody,
  okResponse,
  refreshBody,
  registerBody,
  updateMeBody,
  userPublic,
} from '@xeno/shared';

const strict = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { auth } = app.deps.services;

  app.post(
    '/auth/register',
    {
      config: strict,
      schema: { tags: ['auth'], body: registerBody, response: { 201: authResponse } },
    },
    async (req, reply) => reply.code(201).send(await auth.register(req.body)),
  );

  app.post(
    '/auth/login',
    { config: strict, schema: { tags: ['auth'], body: loginBody, response: { 200: authResponse } } },
    async (req) => auth.login(req.body),
  );

  app.post(
    '/auth/refresh',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], body: refreshBody, response: { 200: authTokens } },
    },
    async (req) => auth.refresh(req.body.refreshToken),
  );

  app.post(
    '/auth/logout',
    { schema: { tags: ['auth'], body: refreshBody, response: { 200: okResponse } } },
    async (req) => {
      await auth.logout(req.body.refreshToken);
      return { ok: true as const };
    },
  );

  app.get(
    '/me',
    {
      onRequest: app.authenticate,
      schema: { tags: ['auth'], security: [{ bearer: [] }], response: { 200: userPublic } },
    },
    async (req) => auth.getUser(req.userId),
  );

  app.patch(
    '/me',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['auth'],
        security: [{ bearer: [] }],
        body: updateMeBody,
        response: { 200: userPublic },
      },
    },
    async (req) => auth.updateUser(req.userId, req.body),
  );
};
