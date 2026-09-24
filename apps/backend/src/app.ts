import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import type { Deps } from './deps.js';
import { authPlugin } from './plugins/auth.js';
import { errorsPlugin } from './plugins/errors.js';
import { healthRoutes } from './modules/health/routes.js';
import { registerModules } from './modules/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}

export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

/** Builds the HTTP app without listening, so tests can use `app.inject()`. */
export async function buildApp(deps: Deps): Promise<App> {
  const { env } = deps;
  const app = Fastify({
    loggerInstance: deps.log as FastifyBaseLogger,
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    bodyLimit: 256 * 1024,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);

  await app.register(errorsPlugin);
  await app.register(authPlugin);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? env.CORS_ORIGINS : env.CORS_ORIGINS.length ? env.CORS_ORIGINS : true,
    credentials: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: env.NODE_ENV === 'test' ? () => true : undefined,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Xeno Garden API',
        version: '2.0.0',
        description: 'Smart irrigation backend. Realtime events are on Socket.IO namespace /rt.',
      },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
  });
  if (env.NODE_ENV !== 'production') {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  await app.register(healthRoutes, { prefix: '/v1' });
  await app.register(registerModules, { prefix: '/v1' });

  return app;
}
