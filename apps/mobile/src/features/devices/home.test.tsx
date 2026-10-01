import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useSession } from '@/lib/session';
import { makeDevice, reported } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { HomeScreen } from './HomeScreen';

const mockList = jest.fn();
const mockPump = jest.fn();
const mockSetMode = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      devices: {
        list: () => mockList(),
        pump: (...a: unknown[]) => mockPump(...a),
        setMode: (...a: unknown[]) => mockSetMode(...a),
      },
    },
  };
});

beforeEach(() => {
  mockList.mockReset();
  mockPump.mockReset();
  mockSetMode.mockReset();
  useSession.setState({ status: 'signedIn', accessToken: 'x', user: { id: 'u', email: 'a@b.co', name: 'Ann Smith', guest: false, createdAt: '' } });
});

describe('HomeScreen', () => {
  it('shows an inviting empty state that finds devices', async () => {
    mockList.mockResolvedValue([]);
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText('Let’s find your devices')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Find my devices' }));
    expect(router.push).toHaveBeenCalledWith('/setup');
  });

  it('does not greet guests by their placeholder name', async () => {
    useSession.setState({ user: { id: 'u', email: null, name: 'My garden', guest: true, createdAt: '' } });
    mockList.mockResolvedValue([]);
    await renderWithProviders(<HomeScreen />);
    await screen.findByText('Let’s find your devices');
    expect(screen.queryByText(/, My$/)).toBeNull();
  });

  it('greets the user and renders live device cards', async () => {
    mockList.mockResolvedValue([
      makeDevice(),
      makeDevice({
        id: 'aaaaaaaaaaaaaaaaaaaaaaa2',
        name: 'Herbs',
        online: false,
        reported: reported({ pump: false }),
        latest: { ts: '2026-01-01T00:00:00Z', soilMoisture: 12, temperature: 30, humidity: 40, rain: true, pump: false },
      }),
    ]);
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText('Balcony tomatoes')).toBeOnTheScreen();
    expect(screen.getByText(/, Ann$/)).toBeOnTheScreen();
    expect(screen.getByText('Herbs')).toBeOnTheScreen();
    expect(screen.getAllByText('Thirsty')).toHaveLength(2); // overview tile + card (12% < 30%)
    expect(screen.getByLabelText('Thirsty: 1')).toBeOnTheScreen();
    expect(screen.getByText(/^Offline ·/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Online: 1/2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('device-card-aaaaaaaaaaaaaaaaaaaaaaa1'));
    expect(router.push).toHaveBeenCalledWith('/device/aaaaaaaaaaaaaaaaaaaaaaa1');
  });

  it('shows watering state from the device report', async () => {
    mockList.mockResolvedValue([makeDevice({ reported: reported({ pump: true, pumpReason: 'dry' }) })]);
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findAllByText('Watering')).toHaveLength(2); // badge + overview tile
    expect(screen.getByLabelText('Watering: 1')).toBeOnTheScreen();
    expect(screen.getByText('Watering — soil is dry')).toBeOnTheScreen();
  });

  it('waters and switches auto off straight from the card', async () => {
    const d = makeDevice();
    mockList.mockResolvedValue([d]);
    mockPump.mockResolvedValue({ cmdId: 'c1', device: { ...d, desired: { ...d.desired, version: 2 } } });
    mockSetMode.mockResolvedValue({ ...d, desired: { ...d.desired, mode: 'manual' } });
    await renderWithProviders(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId(`card-water-${d.id}`));
    expect(mockPump).toHaveBeenCalledWith(d.id, { action: 'ON', durationSec: 600 });
    expect(await screen.findByText('Starting…')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`card-auto-${d.id}`));
    expect(mockSetMode).toHaveBeenCalledWith(d.id, 'manual');
  });

  it('cannot water an offline device from the card', async () => {
    const d = makeDevice({ online: false });
    mockList.mockResolvedValue([d]);
    await renderWithProviders(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId(`card-water-${d.id}`));
    expect(mockPump).not.toHaveBeenCalled();
  });

  it('offers a retry when loading fails', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("Couldn't load your garden")).toBeOnTheScreen();
  });
});
