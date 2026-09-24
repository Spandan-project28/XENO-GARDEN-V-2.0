import type { AuthResponse, AuthTokens, LoginBody, RegisterBody, UserPublic } from '@xeno/shared';
import type { Types } from 'mongoose';
import { RefreshToken, User, type UserDoc } from '../../db/models.js';
import {
  getDummyHash,
  hashPassword,
  newId,
  randomToken,
  sha256,
  verifyPassword,
  type AccessTokens,
} from '../../lib/crypto.js';
import { AppError, notFound, unauthorized } from '../../lib/errors.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MIN = 15;

export const toUserPublic = (u: Pick<UserDoc, '_id' | 'email' | 'name' | 'createdAt'>): UserPublic => ({
  id: u._id.toHexString(),
  email: u.email,
  name: u.name,
  createdAt: u.createdAt.toISOString(),
});

export interface AuthServiceDeps {
  tokens: AccessTokens;
  refreshTtlDays: number;
  now: () => Date;
}

export function createAuthService({ tokens, refreshTtlDays, now }: AuthServiceDeps) {
  async function issueTokens(
    userId: Types.ObjectId,
    family: string = newId(),
  ): Promise<AuthTokens> {
    const refreshToken = randomToken(48);
    await RefreshToken.create({
      userId,
      tokenHash: sha256(refreshToken),
      family,
      expiresAt: new Date(now().getTime() + refreshTtlDays * 86_400_000),
    });
    return {
      accessToken: tokens.sign({ sub: userId.toHexString() }),
      refreshToken,
      expiresIn: tokens.ttlSec,
    };
  }

  async function revokeFamily(family: string) {
    await RefreshToken.updateMany({ family, revokedAt: null }, { revokedAt: now() });
  }

  return {
    async register(body: RegisterBody): Promise<AuthResponse> {
      if (await User.exists({ email: body.email })) {
        throw new AppError('CONFLICT', 'An account with this email already exists');
      }
      const user = await User.create({
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
      }).catch((err: { code?: number }) => {
        if (err.code === 11000) throw new AppError('CONFLICT', 'An account with this email already exists');
        throw err;
      });
      return { ...(await issueTokens(user._id)), user: toUserPublic(user) };
    },

    async login(body: LoginBody): Promise<AuthResponse> {
      const user = await User.findOne({ email: body.email });
      if (!user) {
        await verifyPassword(await getDummyHash(), body.password); // constant-ish timing
        throw unauthorized('Email or password is incorrect');
      }
      const t = now();
      if (user.lockedUntil && user.lockedUntil > t) {
        const mins = Math.ceil((user.lockedUntil.getTime() - t.getTime()) / 60_000);
        throw new AppError('RATE_LIMITED', `Too many failed attempts. Try again in ${mins} min.`);
      }
      if (!(await verifyPassword(user.passwordHash, body.password))) {
        const failed = user.failedLogins + 1;
        await User.updateOne(
          { _id: user._id },
          failed >= MAX_FAILED_LOGINS
            ? { failedLogins: 0, lockedUntil: new Date(t.getTime() + LOCKOUT_MIN * 60_000) }
            : { failedLogins: failed },
        );
        throw unauthorized('Email or password is incorrect');
      }
      if (user.failedLogins || user.lockedUntil) {
        await User.updateOne({ _id: user._id }, { failedLogins: 0, lockedUntil: null });
      }
      return { ...(await issueTokens(user._id)), user: toUserPublic(user) };
    },

    /**
     * Rotates a refresh token. Presenting an already-rotated token means it leaked:
     * the whole family (every session descended from that login) is revoked.
     */
    async refresh(refreshToken: string): Promise<AuthTokens> {
      const tokenHash = sha256(refreshToken);
      const t = now();
      const current = await RefreshToken.findOneAndUpdate(
        { tokenHash, replacedAt: null, revokedAt: null, expiresAt: { $gt: t } },
        { replacedAt: t },
      );
      if (!current) {
        const known = await RefreshToken.findOne({ tokenHash });
        if (known && (known.replacedAt || known.revokedAt)) await revokeFamily(known.family);
        throw unauthorized('Session expired, please sign in again');
      }
      return issueTokens(current.userId, current.family);
    },

    async logout(refreshToken: string): Promise<void> {
      const known = await RefreshToken.findOne({ tokenHash: sha256(refreshToken) });
      if (known) await revokeFamily(known.family);
    },

    async getUser(userId: string): Promise<UserPublic> {
      const user = await User.findById(userId);
      if (!user) throw notFound('User');
      return toUserPublic(user);
    },

    async updateUser(userId: string, patch: { name?: string }): Promise<UserPublic> {
      const user = await User.findByIdAndUpdate(userId, { $set: patch }, { new: true });
      if (!user) throw notFound('User');
      return toUserPublic(user);
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
