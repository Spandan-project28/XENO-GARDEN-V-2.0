import { z } from 'zod';
import { ApiClient, ApiError } from './client';

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: Handler, refresh: () => Promise<string | null> = async () => 'fresh') {
  let token: string | null = 'stale';
  const onAuthFailure = jest.fn();
  const refreshSpy = jest.fn(async () => {
    const t = await refresh();
    token = t;
    return t;
  });
  const calls: { url: string; auth?: string }[] = [];
  const client = new ApiClient({
    baseUrl: () => 'https://api.test',
    getAccessToken: () => token,
    refresh: refreshSpy,
    onAuthFailure,
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).authorization });
      return handler(url, init);
    }) as typeof fetch,
  });
  return { client, onAuthFailure, refreshSpy, calls };
}

describe('ApiClient', () => {
  it('sends JSON with the bearer token and builds query strings', async () => {
    const { client, calls } = setup(() => json(200, { ok: true }));
    await client.get('/v1/x', { query: { a: 1, b: 'x y', skip: undefined } });
    expect(calls[0]).toEqual({ url: 'https://api.test/v1/x?a=1&b=x%20y', auth: 'Bearer stale' });
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const { client, calls, refreshSpy } = setup((_u, init) =>
      (init.headers as Record<string, string>).authorization === 'Bearer fresh' ? json(200, { v: 1 }) : json(401, {}),
    );
    await expect(client.get('/v1/me')).resolves.toEqual({ v: 1 });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.auth)).toEqual(['Bearer stale', 'Bearer fresh']);
  });

  it('shares a single refresh between concurrent 401s', async () => {
    let resolveRefresh: (v: string) => void = () => {};
    const { client, refreshSpy } = setup(
      (_u, init) =>
        (init.headers as Record<string, string>).authorization === 'Bearer fresh' ? json(200, { v: 1 }) : json(401, {}),
      () => new Promise<string>((r) => (resolveRefresh = r)),
    );
    const all = Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    await new Promise((r) => setTimeout(r, 10));
    resolveRefresh('fresh');
    await all;
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('signs out when the session cannot be refreshed', async () => {
    const { client, onAuthFailure } = setup(() => json(401, { error: { code: 'UNAUTHORIZED', message: 'nope' } }), async () => null);
    await expect(client.get('/v1/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(onAuthFailure).toHaveBeenCalled();
  });

  it('keeps the session when refresh fails because we are offline', async () => {
    const { client, onAuthFailure } = setup(
      () => json(401, {}),
      async () => {
        throw new ApiError(0, 'NETWORK', 'offline');
      },
    );
    await expect(client.get('/v1/me')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('maps the backend error shape', async () => {
    const { client } = setup(() =>
      json(409, { error: { code: 'DEVICE_OFFLINE', message: 'The device is offline.' } }),
    );
    const err = await client.post('/v1/devices/1/pump', { action: 'ON' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'DEVICE_OFFLINE', message: 'The device is offline.' });
  });

  it('turns fetch failures into network errors', async () => {
    const { client } = setup(() => {
      throw new TypeError('Network request failed');
    });
    const err = (await client.get('/v1/x').catch((e: unknown) => e)) as ApiError;
    expect(err.isNetwork).toBe(true);
    expect(err.code).toBe('NETWORK');
  });

  it('validates responses against schemas', async () => {
    const { client } = setup(() => json(200, { n: 'not a number' }));
    await expect(client.get('/x', { schema: z.object({ n: z.number() }) })).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    });
  });

  it('does not send tokens on public endpoints', async () => {
    const { client, calls } = setup(() => json(200, {}));
    await client.post('/v1/auth/login', {}, { auth: false });
    expect(calls[0]!.auth).toBeUndefined();
  });
});
