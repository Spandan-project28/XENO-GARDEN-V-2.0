import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from './secureStorage';
import { useSession } from './session';

const mockGuest = jest.fn();
jest.mock('./api', () => ({ api: { auth: { guest: () => mockGuest() } } }));

// eslint-disable-next-line import/first
import { bootSession } from './bootstrap';

const guestResponse = {
  accessToken: 'acc',
  refreshToken: 'guest-refresh-token-0001',
  expiresIn: 900,
  user: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: null, name: 'My garden', guest: true, createdAt: '2026-01-01T00:00:00.000Z' },
};

beforeEach(async () => {
  mockGuest.mockReset();
  await AsyncStorage.clear();
  await secureStorage.remove('xg.refreshToken');
  useSession.setState({ status: 'loading', user: null, accessToken: null });
});

describe('bootSession', () => {
  it('first launch: creates a guest session silently and opens the garden', async () => {
    mockGuest.mockResolvedValue(guestResponse);
    const seen: string[] = [];
    const off = useSession.subscribe((s) => void seen.push(s.status));
    expect(await bootSession()).toBe('guest');
    off();
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', user: { guest: true } });
    // Never flashes the welcome screen on the way.
    expect(seen).not.toContain('signedOut');
    expect(await secureStorage.get('xg.refreshToken')).toBe(guestResponse.refreshToken);
  });

  it('restores an existing session without calling the server', async () => {
    await secureStorage.set('xg.refreshToken', 'existing-refresh-token-01');
    expect(await bootSession()).toBe('restored');
    expect(mockGuest).not.toHaveBeenCalled();
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('offline on first launch: falls back to the welcome screen', async () => {
    mockGuest.mockRejectedValue(new Error('offline'));
    expect(await bootSession()).toBe('offline');
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('never creates two guests when called twice at start-up', async () => {
    mockGuest.mockResolvedValue(guestResponse);
    await Promise.all([bootSession(), bootSession()]);
    expect(mockGuest).toHaveBeenCalledTimes(1);
  });
});
