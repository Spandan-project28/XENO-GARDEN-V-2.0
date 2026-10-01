import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import { SaveGardenScreen } from './SaveGardenScreen';
import { SignInScreen } from './SignInScreen';
import { WelcomeScreen } from './WelcomeScreen';

const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockGuest = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      auth: {
        login: (b: unknown) => mockLogin(b),
        upgrade: (b: unknown) => mockRegister(b),
        guest: () => mockGuest(),
      },
    },
  };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));

const authResponse = {
  accessToken: 'acc',
  refreshToken: 'ref-ref-ref-ref-ref-ref',
  expiresIn: 900,
  user: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: 'a@b.co', name: 'Ann', guest: false, createdAt: '2026-01-01T00:00:00.000Z' },
};

beforeEach(() => {
  mockLogin.mockReset();
  mockRegister.mockReset();
  mockGuest.mockReset();
  useSession.setState({ status: 'signedOut', user: null, accessToken: null });
});

describe('SignInScreen', () => {
  it('validates with the shared schema before calling the API', async () => {
    await renderWithProviders(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'not-an-email');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(await screen.findByText('Enter a valid email')).toBeOnTheScreen();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('signs in and establishes the session', async () => {
    mockLogin.mockResolvedValue(authResponse);
    await renderWithProviders(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), '  A@B.co ');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'secret-pass');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(useSession.getState().status).toBe('signedIn'));
    expect(mockLogin).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret-pass' });
    expect(useSession.getState()).toMatchObject({ accessToken: 'acc', user: { name: 'Ann' } });
  });

  it('shows a friendly message for wrong credentials', async () => {
    mockLogin.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Email or password is incorrect'));
    await renderWithProviders(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'a@b.co');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'wrong-pass');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(await screen.findByText('Email or password is incorrect')).toBeOnTheScreen();
    expect(useSession.getState().status).toBe('signedOut');
  });
});

describe('WelcomeScreen', () => {
  it('Get started creates a guest session (no sign-up form)', async () => {
    mockGuest.mockResolvedValue({ ...authResponse, user: { ...authResponse.user, email: null, guest: true } });
    await renderWithProviders(<WelcomeScreen />);
    await fireEvent.press(screen.getByTestId('welcome-start'));
    await waitFor(() => expect(useSession.getState().status).toBe('signedIn'));
    expect(useSession.getState().user).toMatchObject({ guest: true });
  });

  it('explains when the phone is offline', async () => {
    mockGuest.mockRejectedValue(new ApiError(0, 'NETWORK', 'offline'));
    await renderWithProviders(<WelcomeScreen />);
    await fireEvent.press(screen.getByTestId('welcome-start'));
    expect(await screen.findByText('No internet connection')).toBeOnTheScreen();
    expect(useSession.getState().status).toBe('signedOut');
  });
});

describe('SaveGardenScreen', () => {
  it('upgrades the guest account and keeps the session', async () => {
    useSession.setState({
      status: 'signedIn',
      accessToken: 'acc',
      user: { ...authResponse.user, email: null, guest: true, name: 'My garden' },
    });
    mockRegister.mockResolvedValue({ ...authResponse.user, email: 'a@b.co', name: 'Ann', guest: false });
    await renderWithProviders(<SaveGardenScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Ann');
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), 'A@b.co');
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'long-enough-1');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    await waitFor(() => expect(useSession.getState().user).toMatchObject({ guest: false, email: 'a@b.co' }));
    expect(mockRegister).toHaveBeenCalledWith({ name: 'Ann', email: 'a@b.co', password: 'long-enough-1' });
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('maps a duplicate email to the email field', async () => {
    mockRegister.mockRejectedValue(new ApiError(409, 'CONFLICT', 'exists'));
    await renderWithProviders(<SaveGardenScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Ann');
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), 'a@b.co');
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'long-enough-1');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(await screen.findByText('An account with this email already exists')).toBeOnTheScreen();
  });

  it('requires 8+ character passwords', async () => {
    await renderWithProviders(<SaveGardenScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Ann');
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), 'a@b.co');
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'short');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(await screen.findByText('Use at least 8 characters')).toBeOnTheScreen();
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
