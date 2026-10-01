import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RefreshToken, User } from '../../src/db/models.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';

let t: TestApp;

beforeAll(async () => {
  await startMongo();
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
  await stopMongo();
});
beforeEach(clearDb);

const post = (url: string, payload: unknown, headers?: Record<string, string>) =>
  t.app.inject({ method: 'POST', url, payload: payload as object, headers });

describe('auth', () => {
  it('registers, returns tokens, and never exposes the hash', async () => {
    const res = await post('/v1/auth/register', {
      email: 'Ann@Example.com',
      password: 'super-secret-1',
      name: 'Ann',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({ email: 'ann@example.com', name: 'Ann' });
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.expiresIn).toBe(900);
    expect(res.body).not.toContain('passwordHash');
    const stored = await User.findOne({ email: 'ann@example.com' });
    expect(stored?.passwordHash).toMatch(/^\$argon2/);
  });

  it('rejects duplicate emails with 409', async () => {
    await t.signUp('dup@example.com');
    const res = await post('/v1/auth/register', {
      email: 'DUP@example.com',
      password: 'another-pass',
      name: 'B',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('validates input with shared schemas', async () => {
    const res = await post('/v1/auth/register', { email: 'bad', password: '1', name: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('logs in with correct credentials only', async () => {
    await t.signUp('log@example.com', 'right-password');
    expect((await post('/v1/auth/login', { email: 'log@example.com', password: 'wrong-pass' })).statusCode).toBe(401);
    expect((await post('/v1/auth/login', { email: 'nobody@example.com', password: 'x' })).statusCode).toBe(401);
    const ok = await post('/v1/auth/login', { email: 'LOG@example.com', password: 'right-password' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe('log@example.com');
  });

  it('locks the account after 5 failed attempts', async () => {
    await t.signUp('lock@example.com', 'right-password');
    for (let i = 0; i < 5; i++) {
      await post('/v1/auth/login', { email: 'lock@example.com', password: 'wrong-pass' });
    }
    const res = await post('/v1/auth/login', { email: 'lock@example.com', password: 'right-password' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toMatch(/Try again in 15 min/);
  });

  it('GET/PATCH /me require a valid token', async () => {
    const u = await t.signUp();
    expect((await t.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer junk' } }))
        .statusCode,
    ).toBe(401);
    const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: u.headers });
    expect(me.json().id).toBe(u.userId);
    const patched = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: u.headers,
      payload: { name: 'Renamed' },
    });
    expect(patched.json().name).toBe('Renamed');
  });

  it('rotates refresh tokens', async () => {
    const u = await t.signUp();
    const r1 = await post('/v1/auth/refresh', { refreshToken: u.refreshToken });
    expect(r1.statusCode).toBe(200);
    const next = r1.json().refreshToken;
    expect(next).not.toBe(u.refreshToken);
    const r2 = await post('/v1/auth/refresh', { refreshToken: next });
    expect(r2.statusCode).toBe(200);
  });

  it('detects refresh token reuse and revokes the family', async () => {
    const u = await t.signUp();
    const r1 = await post('/v1/auth/refresh', { refreshToken: u.refreshToken });
    const stolenReuse = await post('/v1/auth/refresh', { refreshToken: u.refreshToken });
    expect(stolenReuse.statusCode).toBe(401);
    // the legitimate newer token is now dead too
    const legit = await post('/v1/auth/refresh', { refreshToken: r1.json().refreshToken });
    expect(legit.statusCode).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('logout revokes the session', async () => {
    const u = await t.signUp();
    expect((await post('/v1/auth/logout', { refreshToken: u.refreshToken })).statusCode).toBe(200);
    expect((await post('/v1/auth/refresh', { refreshToken: u.refreshToken })).statusCode).toBe(401);
  });
});

describe('guest accounts (simple mode)', () => {
  it('creates a guest session with no email, usable like any other', async () => {
    const res = await post('/v1/auth/guest', {});
    expect(res.statusCode).toBe(201);
    const g = res.json();
    expect(g.user).toMatchObject({ email: null, guest: true, name: 'My garden' });
    const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${g.accessToken}` } });
    expect(me.json()).toMatchObject({ id: g.user.id, guest: true });
    // Rotation works the same as for email accounts.
    expect((await post('/v1/auth/refresh', { refreshToken: g.refreshToken })).statusCode).toBe(200);
  });

  it('allows many guests (no unique clash on a missing email)', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/v1/auth/guest', {})).statusCode).toBe(201);
    expect(await User.countDocuments({ guest: true })).toBe(3);
  });

  it('upgrades a guest to an email account, keeping the same user', async () => {
    const g = (await post('/v1/auth/guest', {})).json();
    const auth = { authorization: `Bearer ${g.accessToken}` };
    const up = await post('/v1/auth/upgrade', { email: 'Save@Example.com', password: 'garden-pass-1', name: 'Asha' }, auth);
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ id: g.user.id, email: 'save@example.com', name: 'Asha', guest: false });
    const login = await post('/v1/auth/login', { email: 'save@example.com', password: 'garden-pass-1' });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.id).toBe(g.user.id);
    // Only once.
    const again = await post('/v1/auth/upgrade', { email: 'other@example.com', password: 'garden-pass-1', name: 'A' }, auth);
    expect(again.statusCode).toBe(409);
  });

  it('refuses to upgrade onto an email that is already used', async () => {
    await t.signUp('taken@example.com');
    const g = (await post('/v1/auth/guest', {})).json();
    const res = await post(
      '/v1/auth/upgrade',
      { email: 'taken@example.com', password: 'garden-pass-1', name: 'A' },
      { authorization: `Bearer ${g.accessToken}` },
    );
    expect(res.statusCode).toBe(409);
  });

  it('requires a session to upgrade', async () => {
    expect((await post('/v1/auth/upgrade', { email: 'x@example.com', password: 'garden-pass-1', name: 'A' })).statusCode).toBe(401);
  });
});
