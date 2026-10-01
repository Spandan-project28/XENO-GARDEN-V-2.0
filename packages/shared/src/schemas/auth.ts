import { z } from 'zod';
import { isoDate, objectId } from './common.js';

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email' }))
  .pipe(z.string().max(254));

export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters');

export const displayName = z.string().trim().min(1, 'Enter your name').max(60);

export const registerBody = z.object({ email, password, name: displayName });
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({ email, password: z.string().min(1).max(128) });
export type LoginBody = z.infer<typeof loginBody>;

/** Attach an email + password to the current guest account; keeps its devices. */
export const upgradeBody = registerBody;
export type UpgradeBody = RegisterBody;

export const refreshBody = z.object({ refreshToken: z.string().min(20).max(512) });
export type RefreshBody = z.infer<typeof refreshBody>;

export const userPublic = z.object({
  id: objectId,
  /** Null for guest accounts (created silently on first launch, §15). */
  email: z.string().nullable(),
  name: z.string(),
  /** True until the user attaches an email ("Save your garden"). */
  guest: z.boolean(),
  createdAt: isoDate,
});
export type UserPublic = z.infer<typeof userPublic>;

export const authTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokens>;

export const authResponse = authTokens.extend({ user: userPublic });
export type AuthResponse = z.infer<typeof authResponse>;

export const updateMeBody = z.object({ name: displayName.optional() });
export type UpdateMeBody = z.infer<typeof updateMeBody>;

export const pushTokenBody = z.object({
  token: z.string().min(10).max(300),
  platform: z.enum(['ios', 'android', 'web']),
});
export type PushTokenBody = z.infer<typeof pushTokenBody>;

export const notificationPrefs = z.object({
  enabled: z.boolean(),
  types: z.record(z.string(), z.boolean()),
});
export type NotificationPrefs = z.infer<typeof notificationPrefs>;
