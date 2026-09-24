import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import { SignInScreen } from './SignInScreen';
import { SignUpScreen } from './SignUpScreen';

const mockLogin = jest.fn();
const mockRegister = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: { auth: { login: (b: unknown) => mockLogin(b), register: (b: unknown) => mockRegister(b) } },
  };
});

const authResponse = {
  accessToken: 'acc',
  refreshToken: 'ref-ref-ref-ref-ref-ref',
  expiresIn: 900,
  user: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: 'a@b.co', name: 'Ann', createdAt: '2026-01-01T00:00:00.000Z' },
};

beforeEach(() => {
  mockLogin.mockReset();
  mockRegister.mockReset();
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

describe('SignUpScreen', () => {
  it('maps a duplicate email to the email field', async () => {
    mockRegister.mockRejectedValue(new ApiError(409, 'CONFLICT', 'exists'));
    await renderWithProviders(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Ann');
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), 'a@b.co');
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'long-enough-1');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(await screen.findByText('An account with this email already exists')).toBeOnTheScreen();
  });

  it('requires 8+ character passwords', async () => {
    await renderWithProviders(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Ann');
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), 'a@b.co');
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'short');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(await screen.findByText('Use at least 8 characters')).toBeOnTheScreen();
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
