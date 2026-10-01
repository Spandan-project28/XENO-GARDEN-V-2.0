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
  useSession.setState({ status: 'signedIn', accessToken: 'a', user: { id: 'u', email: 'ann@example.com', name: 'Ann Smith', guest: false, createdAt: '' } });
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

  it('guests see "Save your garden" and a sign-out warning', async () => {
    useSession.setState({
      status: 'signedIn',
      accessToken: 'a',
      user: { id: 'u', email: null, name: 'My garden', guest: true, createdAt: '' },
    });
    const titles: string[] = [];
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((title) => void titles.push(title));
    await renderWithProviders(<SettingsScreen />);
    expect(screen.getByText('Only on this phone')).toBeOnTheScreen();
    expect(screen.getByTestId('save-garden')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(titles).toEqual(['Your garden isn’t saved']);
    expect(useSession.getState().status).toBe('signedIn');
    spy.mockRestore();
  });

  it('email accounts do not see the save prompt', async () => {
    await renderWithProviders(<SettingsScreen />);
    expect(screen.queryByTestId('save-garden')).toBeNull();
    expect(screen.getByText('ann@example.com')).toBeOnTheScreen();
  });
});
