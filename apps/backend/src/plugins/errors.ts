import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import type { ApiError } from '@xeno/shared';
import { AppError } from '../lib/errors.js';

/** Maps every error to the `{error: {code, message, details?}}` shape (plan §7.2). */
export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((req, reply) => {
    const body: ApiError = {
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
    };
    return reply.code(404).send(body);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    let status = 500;
    let body: ApiError;

    if (err instanceof AppError) {
      status = err.statusCode;
      body = { error: { code: err.code, message: err.message, details: err.details } };
    } else if (hasZodFastifySchemaValidationErrors(err)) {
      status = 400;
      body = {
        error: {
          code: 'VALIDATION_FAILED',
          message: firstIssueMessage(err.validation) ?? 'Request is invalid',
          details: err.validation.map((v) => ({
            path: `${err.validationContext ?? ''}${v.instancePath}`,
            message: v.message,
          })),
        },
      };
    } else if (isResponseSerializationError(err)) {
      req.log.error({ err, issues: err.cause?.issues }, 'response failed schema');
      body = { error: { code: 'INTERNAL', message: 'Internal server error' } };
    } else if (err.statusCode === 429) {
      status = 429;
      body = { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } };
    } else if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      status = err.statusCode;
      body = {
        error: {
          code: status === 401 ? 'UNAUTHORIZED' : status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
          message: err.message,
        },
      };
    } else {
      req.log.error({ err }, 'unhandled error');
      body = { error: { code: 'INTERNAL', message: 'Internal server error' } };
    }

    return reply.code(status).send(body);
  });
});

function firstIssueMessage(validation: { message?: string; instancePath: string }[]) {
  const first = validation[0];
  if (!first?.message) return undefined;
  const field = first.instancePath.replace(/^\//, '').replace(/\//g, '.');
  return field ? `${field}: ${first.message}` : first.message;
}
