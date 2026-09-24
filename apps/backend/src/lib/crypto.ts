import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { createSigner, createVerifier } from 'fast-jwt';

/** Slow hash for human passwords. */
export const hashPassword = (password: string) => argonHash(password);
export const verifyPassword = (hash: string, password: string) =>
  argonVerify(hash, password).catch(() => false);

/** A valid argon2 hash of a random string, used to keep login timing constant for unknown emails. */
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= argonHash(randomUUID()));

/** Fast hash for high-entropy machine secrets (refresh tokens, device passwords, claim codes). */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const safeEqualHex = (a: string, b: string) => {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const newId = () => randomUUID();

export interface AccessClaims {
  sub: string;
}

export function createAccessTokens(secret: string, ttlSec: number) {
  const signer = createSigner({ key: secret, expiresIn: ttlSec * 1000, algorithm: 'HS256' });
  const verifier = createVerifier({ key: secret, algorithms: ['HS256'], cache: true });
  return {
    ttlSec,
    sign: (claims: AccessClaims): string => signer(claims),
    /** Throws on invalid/expired tokens. */
    verify: (token: string): AccessClaims => {
      const payload = verifier(token) as Partial<AccessClaims>;
      if (typeof payload.sub !== 'string') throw new Error('Token has no subject');
      return { sub: payload.sub };
    },
  };
}
export type AccessTokens = ReturnType<typeof createAccessTokens>;
