import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import { SettingsScreen } from './SettingsScreen';

const mockGetPrefs = jest.fn();
const mockSetPrefs = jest.fn();
const mockLogout = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      notifications: { getPrefs: () => mockGetPrefs(), setPrefs: (p: unknown) => mockSetPrefs(p) },
      auth: { logout: (r: string) => mockLogout(r), updateMe: jest.fn() },
    },
  };
});

beforeEach(() => {
  mockGetPrefs.mockResolvedValue({ enabled: true, types: {} });
  mockSetPrefs.mockImplementation(async (p) => p);
  mockLogout.mockResolvedValue({ ok: true });
  useSession.setState({ status: 'signedIn', accessToken: 'a', user: { id: 'u', email: 'ann@example.com', name: 'Ann Smith', createdAt: '' } });
  usePrefs.setState({ theme: 'system', units: 'c' });
});

describe('SettingsScreen', () => {
  it('shows the profile and switches theme and units', async () => {
    await renderWithProviders(<SettingsScreen />);
    expect(screen.getByText('Ann Smith')).toBeOnTheScreen();
    expect(screen.getByText('AS')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('segment-light'));
    expect(usePrefs.getState().theme).toBe('light');
    await fireEvent.press(screen.getByTestId('segment-f'));
    expect(usePrefs.getState().units).toBe('f');
  });

  it('saves per-type notification preferences', async () => {
    await renderWithProviders(<SettingsScreen />);
    await fireEvent.press(await screen.findByTestId('notif-HIGH_TEMP'));
    await waitFor(() => expect(mockSetPrefs).toHaveBeenCalledWith({ enabled: true, types: { HIGH_TEMP: false } }));
  });

  it('signs out after confirmation', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await renderWithProviders(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('sign-out'));
    await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));
    spy.mockRestore();
  });
});
