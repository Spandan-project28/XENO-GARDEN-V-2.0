import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Secrets (refresh token) live in the OS keychain/keystore. On web there is no keychain, so
 * localStorage is used — acceptable for the dev/web preview only.
 */
const web = Platform.OS === 'web';

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (web) return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (web) return void globalThis.localStorage?.setItem(key, value);
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (web) return void globalThis.localStorage?.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  },
};
