/**
 * Signed media endpoints (no bearer token: the URL signature is the authorisation).
 *   PUT /v1/media/:key?exp&ct&sig   upload bytes (from a URL issued by /plants/:id/photos/upload-url)
 *   GET /v1/media/:key?exp&sig      read bytes
 */
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, sniffImage } from './storage.js';

type Q = { exp?: string; sig?: string; ct?: string };

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  const storage = app.deps.media;
  for (const ct of ALLOWED_IMAGE_TYPES) {
    app.addContentTypeParser(ct, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => done(null, body));
  }

  app.put<{ Params: { '*': string }; Querystring: Q; Body: Buffer }>(
    '/media/*',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { hide: true } },
    async (req, reply) => {
      const key = req.params['*'];
      if (!storage.verify('PUT', key, req.query)) throw new AppError('FORBIDDEN', 'Upload link is invalid or expired');
      if (req.headers['content-type'] !== req.query.ct) throw new AppError('BAD_REQUEST', 'Content type does not match the upload link');
      if (!Buffer.isBuffer(req.body) || sniffImage(req.body) !== req.query.ct) {
        throw new AppError('BAD_REQUEST', 'The file is not a valid JPEG, PNG or WebP image');
      }
      await storage.write(key, req.body);
      return reply.code(201).send({ ok: true });
    },
  );

  app.get<{ Params: { '*': string }; Querystring: Q }>('/media/*', { schema: { hide: true } }, async (req, reply) => {
    const key = req.params['*'];
    if (!storage.verify('GET', key, req.query)) throw new AppError('FORBIDDEN', 'Link is invalid or expired');
    if (!(await storage.exists(key))) throw new AppError('NOT_FOUND', 'Not found');
    const buf = await storage.read(key);
    return reply
      .header('content-type', sniffImage(buf) ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=3600')
      .send(buf);
  });
};
