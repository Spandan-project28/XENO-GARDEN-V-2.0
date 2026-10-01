import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { MockTransport, SIMULATED_DEVICES } from '@/lib/ble/mock';
import { queryClient } from '@/lib/queryClient';
import { qk } from '@/lib/queryKeys';
import { makeDevice } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { AutoSetup } from './autoSetup';
import { setAutoSetupFactory } from './controller';
import { NearbyCard } from './NearbyCard';
import { SetupScreen } from './SetupScreen';

jest.mock('@/lib/api', () => ({ api: { devices: {} } }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const vaultMap = new Map<string, string>();

function install(opts: { phone?: string | null } = {}) {
  const mine: ReturnType<typeof makeDevice>[] = [];
  setAutoSetupFactory(
    () =>
      new AutoSetup({
        transport: new MockTransport(SIMULATED_DEVICES, 2),
        claim: async (hw) => {
          const device = makeDevice({ id: `dddddddddddddddddddddd0${mine.length + 1}`, hardwareId: hw, name: `Xeno ${mine.length + 1}`, online: false });
          mine.push(device);
          return { device, mqtt: { host: 'mqtt.example.com', port: 8883, tls: true, username: hw, password: 'p'.repeat(32) } };
        },
        getDevice: async (id) => ({ ...mine.find((d) => d.id === id)!, online: true }),
        myDevices: () => mine,
        phoneWifi: async () => (opts.phone === undefined ? 'Home WiFi' : opts.phone),
        vault: {
          get: async (s) => vaultMap.get(s) ?? null,
          save: async (s, p) => void vaultMap.set(s, p),
          forget: async (s) => void vaultMap.delete(s),
        },
        timing: { joinTimeoutMs: 2000, confirmTimeoutMs: 100, pollMs: 2 },
      }),
  );
}

beforeEach(() => {
  vaultMap.clear();
  mockPush.mockReset();
  queryClient.setQueryData(qk.devices, []);
});
afterAll(() => setAutoSetupFactory(null));

describe('SetupScreen', () => {
  it('finds Xeno 1 and Xeno 2, asks for the WiFi password once, and connects both', async () => {
    install();
    await renderWithProviders(<SetupScreen />);
    expect(await screen.findByText('Xeno 1')).toBeOnTheScreen();
    expect(await screen.findByText('Xeno 2')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('setup-connect-all'));
    expect(await screen.findByText('WiFi for Xeno 1')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('wifi-prompt-password'), 'garden-pass');
    await fireEvent.press(screen.getByTestId('wifi-prompt-connect'));

    expect(await screen.findByText('2 devices are ready', {}, { timeout: 4000 })).toBeOnTheScreen();
    expect(screen.queryByTestId('wifi-prompt')).toBeNull();
    expect(vaultMap.get('Home WiFi')).toBe('garden-pass');
    expect(screen.getByTestId('setup-finish')).toBeOnTheScreen();
  });

  it('connects with zero typing when the password is already known', async () => {
    vaultMap.set('Home WiFi', 'garden-pass');
    install();
    await renderWithProviders(<SetupScreen />);
    await screen.findByText('Xeno 2');
    await fireEvent.press(screen.getByTestId('setup-connect-all'));
    expect(await screen.findByText('2 devices are ready', {}, { timeout: 4000 })).toBeOnTheScreen();
  });

  it('validates the password before sending it to the device', async () => {
    install();
    await renderWithProviders(<SetupScreen />);
    await screen.findByText('Xeno 2');
    await fireEvent.press(screen.getByTestId('setup-connect-all'));
    await screen.findByTestId('wifi-prompt');
    await fireEvent.changeText(screen.getByTestId('wifi-prompt-password'), 'short');
    await fireEvent.press(screen.getByTestId('wifi-prompt-connect'));
    expect(await screen.findByText('WiFi passwords are at least 8 characters')).toBeOnTheScreen();
  });

  it('shows a wrong password clearly and lets the user fix it', async () => {
    install();
    await renderWithProviders(<SetupScreen />);
    await screen.findByText('Xeno 2');
    await fireEvent.press(screen.getByTestId('setup-connect-all'));
    await screen.findByTestId('wifi-prompt');
    await fireEvent.changeText(screen.getByTestId('wifi-prompt-password'), 'wrong-password');
    await fireEvent.press(screen.getByTestId('wifi-prompt-connect'));
    expect(await screen.findByText('That password didn’t work', {}, { timeout: 3000 })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('wifi-prompt-password'), 'garden-pass');
    await fireEvent.press(screen.getByTestId('wifi-prompt-connect'));
    expect(await screen.findByText('2 devices are ready', {}, { timeout: 4000 })).toBeOnTheScreen();
  });
});

describe('NearbyCard', () => {
  it('quietly finds devices on the Garden screen and offers one-tap Connect', async () => {
    install();
    await renderWithProviders(<NearbyCard />);
    expect(await screen.findByText('2 new devices nearby')).toBeOnTheScreen();
    expect(screen.getByText('Xeno 1, Xeno 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('nearby-connect'));
    expect(mockPush).toHaveBeenCalledWith('/setup');
  });

  it('stays hidden when nothing is nearby', async () => {
    setAutoSetupFactory(
      () =>
        new AutoSetup({
          transport: new MockTransport([], 2),
          claim: jest.fn(),
          getDevice: jest.fn(),
          myDevices: () => [],
          phoneWifi: async () => null,
          vault: { get: async () => null, save: async () => undefined, forget: async () => undefined },
        }),
    );
    await renderWithProviders(<NearbyCard />);
    await waitFor(() => expect(screen.queryByTestId('nearby-card')).toBeNull());
  });
});
