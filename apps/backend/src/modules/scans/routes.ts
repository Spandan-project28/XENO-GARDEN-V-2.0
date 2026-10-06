/**
 * Plant Scan API (self-contained: its own config, storage prefix and collection).
 *   GET    /v1/scans/status       is a disease model connected?
 *   POST   /v1/scans/upload-url   signed URL to PUT the leaf photo to
 *   POST   /v1/scans              analyse an uploaded photo (optionally linked to a device)
 *   GET    /v1/scans              newest first (?deviceId&limit&cursor)
 *   GET    /v1/scans/:id
 *   DELETE /v1/scans/:id
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createScanBody,
  idParams,
  okResponse,
  scanList,
  scanListQuery,
  scanPublic,
  scanServiceStatus,
  scanUploadRequest,
  scanUploadResponse,
} from '@xeno/shared';
import { loadScanConfig, type ScanConfig } from './config.js';
import { HttpDiseaseDetector, type DiseaseDetector } from './detector.js';
import { createScanService } from './service.js';

export interface ScanRoutesOptions {
  config?: ScanConfig;
  detector?: DiseaseDetector;
}

export const scanRoutes: FastifyPluginAsyncZod<ScanRoutesOptions> = async (app, opts) => {
  const config = opts.config ?? loadScanConfig(process.env);
  const detector = opts.detector ?? new HttpDiseaseDetector(config);
  if (config.ready) app.log.info({ model: config.modelName, preset: config.preset }, 'plant scan: model connected');
  else app.log.info(`plant scan: ${config.problem}`);

  const scans = createScanService({
    config,
    detector,
    storage: app.deps.media,
    devices: app.deps.services.devices,
    log: app.deps.log,
    now: app.deps.now,
  });

  app.addHook('onRequest', app.authenticate);
  const common = { tags: ['scans'], security: [{ bearer: [] }] };
  const base = (req: FastifyRequest) => app.deps.env.PUBLIC_URL?.replace(/\/+$/, '') ?? `${req.protocol}://${req.host}`;

  app.get('/scans/status', { schema: { ...common, response: { 200: scanServiceStatus } } }, async () => scans.status());

  app.post(
    '/scans/upload-url',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { ...common, body: scanUploadRequest, response: { 200: scanUploadResponse } },
    },
    async (req) => scans.createUpload(req.userId, req.body.contentType, base(req)),
  );

  app.post(
    '/scans',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { ...common, body: createScanBody, response: { 201: scanPublic } },
    },
    async (req, reply) => reply.code(201).send(await scans.create(req.userId, req.body, base(req))),
  );

  app.get(
    '/scans',
    { schema: { ...common, querystring: scanListQuery, response: { 200: scanList } } },
    async (req) => scans.list(req.userId, req.query, base(req)),
  );

  app.get(
    '/scans/:id',
    { schema: { ...common, params: idParams, response: { 200: scanPublic } } },
    async (req) => scans.get(req.userId, req.params.id, base(req)),
  );

  app.delete(
    '/scans/:id',
    { schema: { ...common, params: idParams, response: { 200: okResponse } } },
    async (req) => {
      await scans.remove(req.userId, req.params.id);
      return { ok: true as const };
    },
  );
};
