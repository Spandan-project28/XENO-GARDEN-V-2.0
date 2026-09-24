import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { unauthorized } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `app.authenticate` for protected routes. */
    userId: string;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Adds `app.authenticate` (use as `onRequest`) which verifies the Bearer access token. */
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('userId', '');
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    try {
      req.userId = app.deps.tokens.verify(header.slice(7)).sub;
    } catch {
      throw unauthorized('Access token is invalid or expired');
    }
  });
});
