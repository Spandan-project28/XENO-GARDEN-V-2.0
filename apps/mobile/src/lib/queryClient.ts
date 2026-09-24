import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { ApiError } from './api/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 3600_000,
      retry: (count, err) => {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
        return count < 2;
      },
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    },
    mutations: { retry: 0 },
  },
});

/** Cached server data survives restarts → the app opens with last-known values, even offline. */
export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'xg-query-cache',
  throttleTime: 2000,
});

let wired = false;
/** Teaches TanStack Query about connectivity (NetInfo) and app focus (AppState). */
export function wireQueryEnvironment() {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)),
  );
  if (Platform.OS !== 'web') {
    focusManager.setEventListener((handleFocus) => {
      const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
      return () => sub.remove();
    });
  }
}
