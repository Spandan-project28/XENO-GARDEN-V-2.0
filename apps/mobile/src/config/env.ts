import Constants from 'expo-constants';

/** Port the backend listens on in local development (matches tools/dev.mjs). */
const DEV_API_PORT = 4000;

const trimSlash = (u: string) => u.replace(/\/+$/, '');

/**
 * Resolves the backend URL without anyone typing an IP address:
 *  1. EXPO_PUBLIC_API_URL (set per EAS environment, or written to .env.local by `npm run dev`)
 *  2. in development: the machine serving the JS bundle (Metro) — the same computer runs the backend
 *  3. otherwise null → the app shows a configuration screen instead of failing silently
 */
export function resolveApiUrl(
  explicit: string | undefined,
  hostUri: string | undefined | null,
  isDev: boolean,
): string | null {
  if (explicit && /^https?:\/\//.test(explicit.trim())) return trimSlash(explicit.trim());
  if (isDev && hostUri) {
    const host = hostUri.split(':')[0];
    if (host) return `http://${host}:${DEV_API_PORT}`;
  }
  return null;
}

export const env = {
  apiUrl: resolveApiUrl(
    process.env.EXPO_PUBLIC_API_URL,
    Constants.expoConfig?.hostUri ?? null,
    __DEV__,
  ),
  appVersion: Constants.expoConfig?.version ?? '2.0.0',
  /** EAS project id, needed for Expo push tokens (set after `eas init`). */
  easProjectId:
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null,
} as const;
