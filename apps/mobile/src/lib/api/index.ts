/**
 * App-wide API singleton, wired to the session store.
 */
import { env } from '@/config/env';
import { sessionStore } from '@/lib/session';
import { ApiClient, ApiError } from './client';
import { createEndpoints } from './endpoints';

let refreshFn: () => Promise<string | null> = async () => null;

export const apiClient = new ApiClient({
  baseUrl: () => env.apiUrl,
  getAccessToken: sessionStore.getAccessToken,
  refresh: () => refreshFn(),
  onAuthFailure: () => void sessionStore.clear(),
});

export const api = createEndpoints(apiClient);

refreshFn = async () => {
  const refreshToken = await sessionStore.getRefreshToken();
  if (!refreshToken) return null;
  try {
    const tokens = await api.auth.refresh(refreshToken);
    await sessionStore.rotate(tokens.accessToken, tokens.refreshToken);
    return tokens.accessToken;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null; // session revoked/expired
    throw err; // offline etc. — keep the session
  }
};

export { ApiClient, ApiError, errorMessage } from './client';
