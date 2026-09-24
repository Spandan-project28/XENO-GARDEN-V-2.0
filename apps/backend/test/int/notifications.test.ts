import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { User } from '../../src/db/models.js';
import { ExpoPushSender, type PushMessage, type PushResult, type PushSender } from '../../src/modules/notifications/sender.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';
import { waitFor, sleep } from '../helpers/mqtt.js';

class FakeSender implements PushSender {
  sent: PushMessage[] = [];
  dead = new Set<string>();
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    this.sent.push(...messages);
    return messages.map((m) => ({ token: m.to, ok: !this.dead.has(m.to), unregistered: this.dead.has(m.to) }));
  }
}

let t: TestApp;
const sender = new FakeSender();
let clock = new Date('2026-05-01T10:00:00Z').getTime();
let headers: { authorization: string };
let userId: string;
let deviceId: string;
const TOKEN = 'ExponentPushToken[abc123]';

beforeAll(async () => {
  await startMongo();
  t = await createTestApp({}, { pushSender: sender, now: () => new Date(clock) });
});
afterAll(async () => {
  await t.app.close();
  await stopMongo();
});
beforeEach(async () => {
  await clearDb();
  sender.sent = [];
  sender.dead.clear();
  const u = await t.signUp();
  headers = u.headers;
  userId = u.userId;
  deviceId = (
    await t.app.inject({
      method: 'POST',
      url: '/v1/devices/claim',
      headers,
      payload: { hardwareId: 'xg-aabbccddeeff', claimCode: 'ABCD2345' },
    })
  ).json().device.id;
});

const register = (h = headers, token = TOKEN) =>
  t.app.inject({ method: 'POST', url: '/v1/me/push-tokens', headers: h, payload: { token, platform: 'android' } });
const raise = () =>
  t.deps.services.alerts.raise({
    deviceId, ownerId: userId, type: 'LOW_MOISTURE', severity: 'critical', message: 'Garden: soil dry', at: new Date(clock),
  });

describe('push notifications', () => {
  it('sends one push when an alert opens, reminds after 30 min only', async () => {
    expect((await register()).statusCode).toBe(200);
    await raise();
    await waitFor(() => sender.sent.length === 1);
    expect(sender.sent[0]).toMatchObject({
      to: TOKEN,
      title: '💧 Soil is dry',
      body: 'Garden: soil dry',
      priority: 'high',
      data: { type: 'alert', deviceId },
    });

    await raise(); // recurrence within 30 min → no push
    await sleep(100);
    expect(sender.sent).toHaveLength(1);

    clock += 31 * 60_000;
    await raise();
    await waitFor(() => sender.sent.length === 2);
    expect(sender.sent[1]!.body).toMatch(/^Still happening \(×3\)/);
  });

  it('respects preferences', async () => {
    await register();
    const res = await t.app.inject({
      method: 'PUT',
      url: '/v1/me/notification-prefs',
      headers,
      payload: { enabled: true, types: { LOW_MOISTURE: false } },
    });
    expect(res.statusCode).toBe(200);
    await raise();
    await sleep(150);
    expect(sender.sent).toHaveLength(0);
    const prefs = await t.app.inject({ method: 'GET', url: '/v1/me/notification-prefs', headers });
    expect(prefs.json()).toEqual({ enabled: true, types: { LOW_MOISTURE: false } });
  });

  it('drops tokens Expo says are dead', async () => {
    await register();
    sender.dead.add(TOKEN);
    await raise();
    await waitFor(async () => ((await User.findById(userId).lean())?.pushTokens.length ?? 1) === 0);
  });

  it('validates tokens and moves a token to the account now using the phone', async () => {
    expect((await register(headers, 'not-a-token')).statusCode).toBe(400);
    await register();
    await register(); // idempotent
    expect((await User.findById(userId).lean())?.pushTokens).toHaveLength(1);
    const other = await t.signUp();
    await register(other.headers);
    expect((await User.findById(userId).lean())?.pushTokens).toHaveLength(0);
    expect((await User.findById(other.userId).lean())?.pushTokens).toHaveLength(1);
    const del = await t.app.inject({ method: 'DELETE', url: '/v1/me/push-tokens', headers: other.headers, payload: { token: TOKEN } });
    expect(del.statusCode).toBe(200);
    expect((await User.findById(other.userId).lean())?.pushTokens).toHaveLength(0);
  });
});

describe('ExpoPushSender', () => {
  it('maps Expo tickets, including DeviceNotRegistered', async () => {
    const calls: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          data: [
            { status: 'ok', id: '1' },
            { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const s = new ExpoPushSender(undefined, fakeFetch);
    const r = await s.send([
      { to: 'ExponentPushToken[a]', title: 't', body: 'b' },
      { to: 'ExponentPushToken[b]', title: 't', body: 'b' },
    ]);
    expect(r).toEqual([
      { token: 'ExponentPushToken[a]', ok: true, unregistered: false, error: undefined },
      { token: 'ExponentPushToken[b]', ok: false, unregistered: true, error: 'gone' },
    ]);
    expect(calls).toHaveLength(1);
  });
});
