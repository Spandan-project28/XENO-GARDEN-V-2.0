jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'storeClient' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android },
}));
jest.mock('expo-notifications', () => {
  throw new Error('expo-notifications must not load in Expo Go on Android');
});
jest.mock('./api', () => ({ api: { notifications: {} } }));
jest.mock('./queryClient', () => ({ queryClient: {} }));
jest.mock('@/config/env', () => ({
  env: { easProjectId: 'proj-123', apiUrl: 'https://api.test', appVersion: '2.0.0' },
}));

// eslint-disable-next-line import/first
import { configureNotificationHandler, getPushStatus, registerPushToken } from './push';

describe('push in Expo Go on Android', () => {
  it('never loads expo-notifications and reports push as unsupported', async () => {
    expect(() => configureNotificationHandler()).not.toThrow();
    expect(await getPushStatus()).toBe('unsupported');
    expect(await registerPushToken(true)).toBe('unsupported');
  });
});
