/**
 * Does what the mobile app does during onboarding, over the public REST API:
 * sign in (or register) a user, then claim devices to receive their MQTT credentials.
 */
import { createHash } from 'node:crypto';
import { CLAIM_CODE_ALPHABET, type ClaimResponse } from '@xeno/shared';

export interface SimIdentity {
  hardwareId: string;
  claimCode: string;
}

/** Stable fake identities derived from a seed, e.g. "xg-5f2c…" + claim code. */
export function simIdentity(seed: string, index: number): SimIdentity {
  const h = createHash('sha256').update(`${seed}:${index}`).digest();
  const hardwareId = `xg-${h.subarray(0, 6).toString('hex')}`;
  let claimCode = '';
  for (let i = 0; i < 8; i++) claimCode += CLAIM_CODE_ALPHABET[h[6 + i]! % CLAIM_CODE_ALPHABET.length];
  return { hardwareId, claimCode };
}

async function call<T>(api: string, path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: T }> {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

export async function signIn(api: string, email: string, password: string): Promise<string> {
  const login = await call<{ accessToken?: string }>(api, '/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (login.status === 200 && login.body.accessToken) return login.body.accessToken;
  const reg = await call<{ accessToken?: string; error?: { message: string } }>(api, '/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name: 'Simulator' }),
  });
  if (reg.status !== 201 || !reg.body.accessToken) {
    throw new Error(`Could not sign in or register ${email}: ${reg.body.error?.message ?? reg.status}`);
  }
  return reg.body.accessToken;
}

export async function claimDevice(
  api: string,
  token: string,
  id: SimIdentity,
  name: string,
): Promise<ClaimResponse> {
  const res = await call<ClaimResponse & { error?: { message: string } }>(api, '/v1/devices/claim', {
    method: 'POST',
    token,
    body: JSON.stringify({ ...id, name }),
  });
  if (res.status !== 201) throw new Error(`Claim of ${id.hardwareId} failed: ${res.body.error?.message ?? res.status}`);
  return res.body;
}
