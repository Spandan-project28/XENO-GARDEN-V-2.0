/**
 * WiFi memory for simple-mode setup (ADR-017).
 *
 *  - `wifiVault` remembers the passwords the user typed during setup (SSID → password), so the
 *    next device on the same network needs no typing at all. Stored only in the OS keychain /
 *    keystore via SecureStore — never AsyncStorage, the query cache or logs.
 *  - `currentPhoneWifi()` reads the name of the WiFi the phone is on, so setup can pick the same
 *    network for the device. Android only reveals it with location permission; iOS needs a special
 *    entitlement, so there it's null and setup falls back to the networks the device can see.
 *
 * Neither OS lets apps read saved WiFi *passwords*: a password is typed once per network, then
 * remembered here.
 */
import NetInfo from '@react-native-community/netinfo';
import { PermissionsAndroid, Platform } from 'react-native';
import { secureStorage } from './secureStorage';

const VAULT_KEY = 'xg.wifiVault';
/** Keep the newest few networks (SecureStore entries should stay small). */
const MAX_NETWORKS = 8;

interface Entry {
  ssid: string;
  pw: string;
  /** Last time it was saved or used, for "most recent first" + eviction. */
  at: number;
}

async function load(): Promise<Entry[]> {
  try {
    const raw = await secureStorage.get(VAULT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is Entry =>
        !!e && typeof e.ssid === 'string' && typeof e.pw === 'string' && typeof e.at === 'number',
    );
  } catch {
    return [];
  }
}

async function store(entries: Entry[]) {
  const newest = [...entries].sort((a, b) => b.at - a.at).slice(0, MAX_NETWORKS);
  await secureStorage.set(VAULT_KEY, JSON.stringify(newest));
}

export const wifiVault = {
  async get(ssid: string): Promise<string | null> {
    return (await load()).find((e) => e.ssid === ssid)?.pw ?? null;
  },
  /** Saved network names, most recently used first. */
  async ssids(): Promise<string[]> {
    return (await load()).sort((a, b) => b.at - a.at).map((e) => e.ssid);
  },
  async save(ssid: string, password: string) {
    const rest = (await load()).filter((e) => e.ssid !== ssid);
    await store([...rest, { ssid, pw: password, at: Date.now() }]);
  },
  /** Called when a saved password turned out to be wrong. */
  async forget(ssid: string) {
    await store((await load()).filter((e) => e.ssid !== ssid));
  },
  async clear() {
    await secureStorage.remove(VAULT_KEY);
  },
};

/** Android placeholder values when the SSID is hidden from the app. */
const UNKNOWN_SSIDS = new Set(['<unknown ssid>', '0x', '']);

async function locationPermission(ask: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const perm = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (await PermissionsAndroid.check(perm)) return true;
  if (!ask) return false;
  const res = await PermissionsAndroid.request(perm, {
    title: 'Use your phone’s WiFi',
    message:
      'Android only shares the name of the WiFi you’re on when location access is allowed. Xeno Garden uses it to connect your device to the same network. Your location isn’t stored or shared.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Name of the WiFi network the phone is connected to, or null (mobile data, iOS, permission
 * refused). `ask` = allowed to show the Android permission prompt.
 */
export async function currentPhoneWifi({ ask }: { ask: boolean }): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    if (!(await locationPermission(ask))) return null;
    const state = await NetInfo.fetch('wifi');
    if (state.type !== 'wifi' || !state.isConnected) return null;
    const raw = (state.details as { ssid?: string | null } | null)?.ssid ?? '';
    const ssid = raw.replace(/^"(.*)"$/, '$1').trim();
    return UNKNOWN_SSIDS.has(ssid) ? null : ssid;
  } catch {
    return null;
  }
}
