import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { MockTransport } from '@/lib/ble/mock';
import { makeDevice } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { ProvisioningFlow } from './flow';
import { OnboardingScreen } from './OnboardingScreen';

jest.mock('@/lib/api', () => ({ api: { devices: {} } }));

const makeFlow = () =>
  new ProvisioningFlow({
    transport: new MockTransport(undefined, 5),
    claim: async () => ({
      device: makeDevice({ id: 'dddddddddddddddddddddddd', name: 'Garden 0001', online: false }),
      mqtt: { host: 'mqtt.example.com', port: 8883, tls: true, username: 'xg-de0000000001', password: 'p'.repeat(32) },
    }),
    getDevice: async () => makeDevice({ online: true }),
    rename: async (_id, name) => makeDevice({ id: 'dddddddddddddddddddddddd', name }),
    timing: { scanTimeoutMs: 1000, joinTimeoutMs: 2000, confirmTimeoutMs: 200, pollMs: 5 },
  });

describe('OnboardingScreen', () => {
  it('walks through the whole wizard with a simulated device', async () => {
    await renderWithProviders(<OnboardingScreen flowFactory={makeFlow} />);
    expect(screen.getByText(/no IP addresses/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('start-scan'));
    await fireEvent.press(await screen.findByTestId('found-sim-1'));

    await fireEvent.press(await screen.findByTestId('network-Home WiFi'));
    await fireEvent.changeText(screen.getByTestId('wifi-password'), 'wrong-one');
    await fireEvent.press(screen.getByTestId('wifi-connect'));
    expect(await screen.findByText('Wrong WiFi password')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('error-retry'));
    await fireEvent.changeText(await screen.findByTestId('wifi-password'), 'garden-pass');
    await fireEvent.press(screen.getByTestId('wifi-connect'));

    await fireEvent.changeText(await screen.findByTestId('device-name'), 'Balcony');
    await fireEvent.press(screen.getByTestId('finish'));
    expect(await screen.findByText('Balcony is ready')).toBeOnTheScreen();
    expect(screen.getByTestId('open-device')).toBeOnTheScreen();
  });

  it('can go back from the password step to the network list', async () => {
    await renderWithProviders(<OnboardingScreen flowFactory={makeFlow} />);
    await fireEvent.press(screen.getByTestId('start-scan'));
    await fireEvent.press(await screen.findByTestId('found-sim-1'));
    await fireEvent.press(await screen.findByTestId('network-Home WiFi'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Choose another network' }));
    await waitFor(() => expect(screen.getByText('Which WiFi should it use?')).toBeOnTheScreen());
  });
});
