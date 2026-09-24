import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const mockRegister = jest.fn(async () => ({ ok: true }));
const mockRemove = jest.fn(async () => ({ ok: true }));
jest.mock('./api', () => ({
  api: { notifications: { registerToken: (...a: unknown[]) => mockRegister(...(a as [])), removeToken: (...a: unknown[]) => mockRemove(...(a as [])) } },
}));
jest.mock('@/config/env', () => ({ env: { easProjectId: 'proj-123', apiUrl: 'https://api.test', appVersion: '2.0.0' } }));

// eslint-disable-next-line import/first
import { getPushStatus, registerPushToken, unregisterPushToken } from './push';

beforeEach(async () => {
  mockRegister.mockClear();
  mockRemove.mockClear();
  await AsyncStorage.clear();
});

describe('push registration', () => {
  it('asks only when allowed to, then registers the Expo token', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'undetermined' } as never);
    expect(await registerPushToken(false)).toBe('undetermined');
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();

    expect(await registerPushToken(true)).toBe('granted');
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(mockRegister).toHaveBeenCalledWith('ExponentPushToken[test]', expect.stringMatching(/ios|android/));
    expect(await AsyncStorage.getItem('xg.pushToken')).toBe('ExponentPushToken[test]');
  });

  it('respects a denied permission', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'denied' } as never);
    expect(await getPushStatus()).toBe('denied');
    expect(await registerPushToken(true)).toBe('denied');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('unregisters the stored token on sign-out', async () => {
    await AsyncStorage.setItem('xg.pushToken', 'ExponentPushToken[old]');
    await unregisterPushToken();
    expect(mockRemove).toHaveBeenCalledWith('ExponentPushToken[old]');
    expect(await AsyncStorage.getItem('xg.pushToken')).toBeNull();
  });
});
