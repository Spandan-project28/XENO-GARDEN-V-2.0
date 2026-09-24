import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, type App } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { AppBus } from '../../src/lib/bus.js';
import { AppError } from '../../src/lib/errors.js';
import type { Deps } from '../../src/deps.js';
import { testEnv } from '../helpers/env.js';

let app: App;
let dbUp = true;

beforeAll(async () => {
  const deps: Deps = {
    env: testEnv(),
    bus: new AppBus(() => {}),
    now: () => new Date('2026-01-01T00:00:00Z'),
    status: { db: () => dbUp, mqtt: () => true, devicesConnected: () => 3 },
  };
  app = await buildApp(deps);
  app.post(
    '/test/echo',
    { schema: { body: z.object({ name: z.string().min(2) }) } },
    async (req) => ({ hi: req.body.name }),
  );
  app.get('/test/app-error', async () => {
    throw new AppError('CONFLICT', 'already there');
  });
  app.get('/test/crash', async () => {
    throw new Error('secret internals');
  });
  await app.ready();
});

afterAll(() => app.close());

describe('app shell', () => {
  it('GET /v1/health reports dependency status', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      checks: { db: true, mqtt: true },
      devicesConnected: 3,
      time: '2026-01-01T00:00:00.000Z',
    });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /v1/health is 503 when the db is down', async () => {
    dbUp = false;
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    dbUp = true;
    expect(res.statusCode).toBe(503);
    expect(res.json().ok).toBe(false);
  });

  it('unknown routes use the error shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /nope not found' },
    });
  });

  it('validation errors are 400 VALIDATION_FAILED with a readable message', async () => {
    const res = await app.inject({ method: 'POST', url: '/test/echo', payload: { name: 'x' } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toMatch(/name/);
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('AppError maps to its status + code', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/app-error' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'CONFLICT', message: 'already there' } });
  });

  it('unexpected errors are 500 without leaking internals', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/crash' });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json())).not.toContain('secret internals');
  });

  it('serves the OpenAPI document', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().info.title).toBe('Xeno Garden API');
  });
});

describe('env', () => {
  it('fails fast with every problem listed', () => {
    expect(() => loadEnv({})).toThrow(/MONGO_URI[\s\S]*JWT_ACCESS_SECRET/);
  });
  it('requires MQTT_URL when not embedded', () => {
    expect(() =>
      loadEnv({
        MONGO_URI: 'mongodb://x/y',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        MQTT_EMBEDDED: 'false',
      }),
    ).toThrow(/MQTT_URL/);
  });
  it('parses CORS list and booleans', () => {
    const env = testEnv({ CORS_ORIGINS: 'https://a.com, https://b.com', DEVICE_BROKER_TLS: 'true' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
    expect(env.DEVICE_BROKER_TLS).toBe(true);
  });
});
