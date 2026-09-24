import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { createDeps } from '../../src/container.js';
import { Metrics } from '../../src/lib/metrics.js';
import { testEnv } from '../helpers/env.js';

const apps: App[] = [];
afterAll(async () => {
  for (const a of apps) await a.close();
});

async function make(env: Record<string, string> = {}) {
  const deps = createDeps(testEnv(env));
  deps.status = { db: () => true, mqtt: () => true, devicesConnected: () => 2 };
  const app = await buildApp(deps);
  await app.ready();
  apps.push(app);
  return { app, deps };
}

describe('metrics', () => {
  it('renders counters and gauges in Prometheus format', () => {
    const m = new Metrics();
    const c = m.counter('x_total', 'test');
    c.inc({ b: '2', a: '1' });
    c.inc({ a: '1', b: '2' }, 2);
    m.gauge('g', 'gauge', () => 7);
    const out = m.render();
    expect(out).toContain('# TYPE x_total counter');
    expect(out).toContain('x_total{a="1",b="2"} 3');
    expect(out).toContain('g 7');
  });

  it('counts HTTP requests and serves metrics outside production', async () => {
    const { app } = await make();
    await app.inject({ method: 'GET', url: '/v1/health' });
    await app.inject({ method: 'GET', url: '/nope' });
    const res = await app.inject({ method: 'GET', url: '/v1/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('xg_http_requests_total{method="GET",status="2xx"} 1');
    expect(res.body).toContain('xg_http_requests_total{method="GET",status="4xx"} 1');
    expect(res.body).toContain('xg_process_uptime_seconds');
  });

  it('requires the token when one is configured', async () => {
    const { app } = await make({ METRICS_TOKEN: 'metrics-token-1234567' });
    expect((await app.inject({ method: 'GET', url: '/v1/metrics' })).statusCode).toBe(404);
    const ok = await app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: 'Bearer metrics-token-1234567' } });
    expect(ok.statusCode).toBe(200);
  });
});
