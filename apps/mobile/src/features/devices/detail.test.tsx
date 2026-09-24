import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { DevicePublic } from '@xeno/shared';
import { useLocalSearchParams } from 'expo-router';
import { makeDevice, reported } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { DeviceDetailScreen } from './DeviceDetailScreen';

const mockGet = jest.fn();
const mockSetMode = jest.fn();
const mockPump = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      devices: {
        get: (id: string) => mockGet(id),
        setMode: (id: string, m: string) => mockSetMode(id, m),
        pump: (id: string, b: unknown) => mockPump(id, b),
        readings: async () => ({
          resolution: '5m',
          from: '',
          to: '',
          points: [30, 32, 35, 33].map((v, i) => ({ ts: new Date(i * 300_000).toISOString(), soilMoisture: v, temperature: 20, humidity: 50, rain: 0, pump: 0 })),
          stats: { soilMoistureAvg: 32.5, temperatureAvg: 20, humidityAvg: 50, pumpOnSec: 420, samples: 4 },
        }),
        pumpEvents: async () => [
          { id: 'e1', deviceId: 'x', source: 'auto', reason: 'dry', stopReason: 'wet', startedAt: new Date(Date.now() - 3600_000).toISOString(), endedAt: new Date().toISOString(), durationSec: 300 },
        ],
      },
    },
  };
});

const ID = 'aaaaaaaaaaaaaaaaaaaaaaa1';
beforeEach(() => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: ID });
  mockGet.mockReset();
  mockSetMode.mockReset();
  mockPump.mockReset();
});

describe('DeviceDetailScreen', () => {
  it('renders the live state, trend and watering history', async () => {
    mockGet.mockResolvedValue(makeDevice({ id: ID, reported: reported({ pumpReason: 'hold' }) }));
    await renderWithProviders(<DeviceDetailScreen />);
    expect(await screen.findByText('Balcony tomatoes')).toBeOnTheScreen();
    expect(screen.getByLabelText('Soil moisture')).toHaveAccessibilityValue({ now: 38 });
    expect(screen.getByTestId('pump-reason')).toHaveTextContent('Soil moisture is in the comfort zone');
    expect(await screen.findByText(/Avg 33% · watered 7 min/)).toBeOnTheScreen();
    expect(await screen.findByText('Last watered 1 h ago')).toBeOnTheScreen();
  });

  it('switches mode optimistically', async () => {
    const d = makeDevice({ id: ID });
    mockGet.mockResolvedValue(d);
    let resolve: (v: DevicePublic) => void = () => {};
    mockSetMode.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderWithProviders(<DeviceDetailScreen />);
    await screen.findByText('Balcony tomatoes');
    await fireEvent.press(screen.getByTestId('segment-manual'));
    expect(await screen.findByText('The pump only runs when you tell it to.')).toBeOnTheScreen();
    expect(screen.getByText('Syncing to device…')).toBeOnTheScreen();
    expect(mockSetMode).toHaveBeenCalledWith(ID, 'manual');
    resolve({ ...d, desired: { ...d.desired, mode: 'manual', version: 2 }, syncPending: true });
  });

  it('sends a pump command with the chosen duration and shows it is starting', async () => {
    const d = makeDevice({ id: ID, desired: { ...makeDevice().desired, settings: { ...makeDevice().desired.settings, maxPumpRunSec: 1800 } } });
    mockGet.mockResolvedValue(d);
    mockPump.mockResolvedValue({ cmdId: 'cmd-1', device: { ...d, desired: { ...d.desired, version: 2 } } });
    await renderWithProviders(<DeviceDetailScreen />);
    await screen.findByText('Balcony tomatoes');
    await fireEvent.press(screen.getByTestId('duration-900'));
    await fireEvent.press(screen.getByTestId('pump-button'));
    await waitFor(() => expect(mockPump).toHaveBeenCalledWith(ID, { action: 'ON', durationSec: 900 }));
    expect(await screen.findByText('Starting…')).toBeOnTheScreen();
  });

  it('disables controls and explains when the device is offline', async () => {
    mockGet.mockResolvedValue(makeDevice({ id: ID, online: false }));
    await renderWithProviders(<DeviceDetailScreen />);
    expect(await screen.findByText(/^Offline · last seen/)).toBeOnTheScreen();
    expect(screen.getByText('Device offline')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('pump-button'));
    expect(mockPump).not.toHaveBeenCalled();
  });
});
