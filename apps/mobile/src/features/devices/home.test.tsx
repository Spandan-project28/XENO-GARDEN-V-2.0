import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useSession } from '@/lib/session';
import { makeDevice, reported } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { HomeScreen } from './HomeScreen';

const mockList = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return { ...actual, api: { devices: { list: () => mockList() } } };
});

beforeEach(() => {
  mockList.mockReset();
  useSession.setState({ status: 'signedIn', accessToken: 'x', user: { id: 'u', email: 'a@b.co', name: 'Ann Smith', createdAt: '' } });
});

describe('HomeScreen', () => {
  it('shows an inviting empty state that starts onboarding', async () => {
    mockList.mockResolvedValue([]);
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("Let's add your first device")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Add device' }));
    expect(router.push).toHaveBeenCalledWith('/onboarding');
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

  it('offers a retry when loading fails', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("Couldn't load your garden")).toBeOnTheScreen();
  });
});
