import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { PermissionsAndroid, Platform } from 'react-native';
import { secureStorage } from './secureStorage';
import { currentPhoneWifi, wifiVault } from './wifi';

beforeEach(async () => {
  await wifiVault.clear();
});

describe('wifiVault', () => {
  it('remembers passwords per network, newest first', async () => {
    await wifiVault.save('Home', 'pw-home-1');
    await new Promise((r) => setTimeout(r, 2));
    await wifiVault.save('Farm', 'pw-farm-1');
    expect(await wifiVault.get('Home')).toBe('pw-home-1');
    expect(await wifiVault.ssids()).toEqual(['Farm', 'Home']);
    await wifiVault.save('Home', 'pw-home-2');
    expect(await wifiVault.get('Home')).toBe('pw-home-2');
    expect(await wifiVault.ssids()).toEqual(['Home', 'Farm']);
  });

  it('forgets a wrong password', async () => {
    await wifiVault.save('Home', 'bad');
    await wifiVault.forget('Home');
    expect(await wifiVault.get('Home')).toBeNull();
  });

  it('lives in the keychain only, never AsyncStorage', async () => {
    await wifiVault.save('Home', 'super-secret-pw');
    const keys = await AsyncStorage.getAllKeys();
    const values = await AsyncStorage.multiGet(keys);
    expect(JSON.stringify(values)).not.toContain('super-secret-pw');
    expect(await secureStorage.get('xg.wifiVault')).toContain('super-secret-pw');
  });

  it('keeps at most 8 networks and survives corrupt data', async () => {
    for (let i = 0; i < 10; i++) await wifiVault.save(`net${i}`, 'x');
    expect(await wifiVault.ssids()).toHaveLength(8);
    await secureStorage.set('xg.wifiVault', '{not json');
    expect(await wifiVault.ssids()).toEqual([]);
  });
});

describe('currentPhoneWifi', () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
    jest.restoreAllMocks();
  });

  const onWifi = (ssid: string | null) =>
    jest.mocked(NetInfo.fetch).mockResolvedValue({
      type: 'wifi',
      isConnected: true,
      details: { ssid },
    } as never);

  it('returns the SSID on Android when location access is allowed', async () => {
    Platform.OS = 'android';
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    onWifi('"Home WiFi"');
    expect(await currentPhoneWifi({ ask: false })).toBe('Home WiFi');
  });

  it('asks only when allowed to, and returns null if refused', async () => {
    Platform.OS = 'android';
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    const req = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    onWifi('Home');
    expect(await currentPhoneWifi({ ask: false })).toBeNull();
    expect(req).not.toHaveBeenCalled();
    expect(await currentPhoneWifi({ ask: true })).toBeNull();
    expect(req).toHaveBeenCalledTimes(1);
  });

  it('treats hidden SSIDs and mobile data as unknown', async () => {
    Platform.OS = 'android';
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    onWifi('<unknown ssid>');
    expect(await currentPhoneWifi({ ask: false })).toBeNull();
    jest.mocked(NetInfo.fetch).mockResolvedValue({ type: 'cellular', isConnected: true, details: {} } as never);
    expect(await currentPhoneWifi({ ask: false })).toBeNull();
  });

  it('is null on iOS (needs a special entitlement)', async () => {
    Platform.OS = 'ios';
    onWifi('Home');
    expect(await currentPhoneWifi({ ask: true })).toBeNull();
  });
});
