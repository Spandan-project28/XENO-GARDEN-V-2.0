/**
 * Session state. The refresh token lives in the keychain; the short-lived access token only in
 * memory. The last known user is cached so the app opens instantly (and offline).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthResponse, UserPublic } from '@xeno/shared';
import { create } from 'zustand';
import { secureStorage } from '@/lib/secureStorage';

const REFRESH_KEY = 'xg.refreshToken';
const USER_KEY = 'xg.user';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: SessionStatus;
  user: UserPublic | null;
  accessToken: string | null;
}

export const useSession = create<SessionState>(() => ({
  status: 'loading',
  user: null,
  accessToken: null,
}));

type Listener = () => void;
const signOutListeners = new Set<Listener>();
/** Other modules (query cache, socket, push) clean up on sign-out. */
export const onSignOut = (l: Listener) => {
  signOutListeners.add(l);
  return () => signOutListeners.delete(l);
};

export const sessionStore = {
  getAccessToken: () => useSession.getState().accessToken,
  getRefreshToken: () => secureStorage.get(REFRESH_KEY),

  async establish(res: AuthResponse) {
    await secureStorage.set(REFRESH_KEY, res.refreshToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.user));
    useSession.setState({ status: 'signedIn', user: res.user, accessToken: res.accessToken });
  },

  async rotate(accessToken: string, refreshToken: string) {
    await secureStorage.set(REFRESH_KEY, refreshToken);
    useSession.setState({ accessToken });
  },

  setUser(user: UserPublic) {
    useSession.setState({ user });
    void AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  /**
   * Restores the session at startup from the keychain + cached profile. Returns false when there
   * is none; the status then stays `loading` so the caller can start a guest session first
   * (see lib/bootstrap) without flashing the welcome screen.
   */
  async restore(): Promise<boolean> {
    const [refresh, cachedUser] = await Promise.all([
      secureStorage.get(REFRESH_KEY),
      AsyncStorage.getItem(USER_KEY),
    ]);
    if (!refresh) return false;
    let user: UserPublic | null = null;
    try {
      user = cachedUser ? (JSON.parse(cachedUser) as UserPublic) : null;
    } catch {
      user = null;
    }
    // Signed in optimistically; the first API call refreshes the access token (or signs out).
    useSession.setState({ status: 'signedIn', user, accessToken: null });
    return true;
  },

  markSignedOut() {
    useSession.setState({ status: 'signedOut', user: null, accessToken: null });
  },

  async clear() {
    await Promise.all([secureStorage.remove(REFRESH_KEY), AsyncStorage.removeItem(USER_KEY)]);
    useSession.setState({ status: 'signedOut', user: null, accessToken: null });
    signOutListeners.forEach((l) => l());
  },
};
