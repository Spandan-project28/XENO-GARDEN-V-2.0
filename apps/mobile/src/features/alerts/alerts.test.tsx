import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { AlertPublic } from '@xeno/shared';
import { useLocalSearchParams } from 'expo-router';
import { renderWithProviders } from '@/test/render';
import { AlertsScreen } from './AlertsScreen';
import { dayLabel } from './meta';

const mockList = jest.fn();
const mockAck = jest.fn();
const mockResolve = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      alerts: {
        list: (q: unknown) => mockList(q),
        ack: (id: string) => mockAck(id),
        resolve: (id: string) => mockResolve(id),
        counts: async () => ({ open: 1, critical: 1 }),
      },
    },
  };
});

const alert = (over: Partial<AlertPublic> = {}): AlertPublic => ({
  id: 'bbbbbbbbbbbbbbbbbbbbbbb1',
  deviceId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
  deviceName: 'Balcony',
  type: 'LOW_MOISTURE',
  severity: 'critical',
  status: 'open',
  message: 'Balcony: soil has stayed dry (12%) for over 10 min.',
  count: 37,
  firstSeenAt: new Date(Date.now() - 3600_000).toISOString(),
  lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  context: {},
  ...over,
});

beforeEach(() => {
  mockList.mockReset();
  mockAck.mockReset();
  mockResolve.mockReset();
  jest.mocked(useLocalSearchParams).mockReturnValue({});
});

describe('dayLabel', () => {
  it('labels today and yesterday', () => {
    const now = new Date(2026, 4, 10, 12).getTime();
    expect(dayLabel(new Date(2026, 4, 10, 8).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 4, 9, 23).toISOString(), now)).toBe('Yesterday');
  });
});

describe('AlertsScreen', () => {
  it('shows "All clear" when nothing is active', async () => {
    mockList.mockResolvedValue({ items: [], nextCursor: null });
    await renderWithProviders(<AlertsScreen />);
    expect(await screen.findByText('All clear')).toBeOnTheScreen();
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ status: ['open', 'acknowledged'] }));
  });

  it('groups alerts by day and shows repeat counts', async () => {
    mockList.mockResolvedValue({
      items: [alert(), alert({ id: 'bbbbbbbbbbbbbbbbbbbbbbb2', type: 'DEVICE_OFFLINE', severity: 'warning', count: 1, lastSeenAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })],
      nextCursor: null,
    });
    await renderWithProviders(<AlertsScreen />);
    expect(await screen.findByText('Soil is dry')).toBeOnTheScreen();
    expect(screen.getByText('Today')).toBeOnTheScreen();
    expect(screen.getByText('×37')).toBeOnTheScreen();
    expect(screen.getByText('Device offline')).toBeOnTheScreen();
  });

  it('resolves from the action sheet and removes it from the active list', async () => {
    mockList.mockResolvedValue({ items: [alert()], nextCursor: null });
    mockResolve.mockResolvedValue({ ...alert(), status: 'resolved' });
    await renderWithProviders(<AlertsScreen />);
    await fireEvent.press(await screen.findByTestId('alert-bbbbbbbbbbbbbbbbbbbbbbb1'));
    expect(await screen.findByText('What to do')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('sheet-resolve'));
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('bbbbbbbbbbbbbbbbbbbbbbb1'));
    await waitFor(() => expect(screen.queryByTestId('alert-bbbbbbbbbbbbbbbbbbbbbbb1')).toBeNull());
  });

  it('opens the alert from a push deep link', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ focus: 'bbbbbbbbbbbbbbbbbbbbbbb1' });
    mockList.mockResolvedValue({ items: [alert()], nextCursor: null });
    await renderWithProviders(<AlertsScreen />);
    expect(await screen.findByText('What to do')).toBeOnTheScreen();
  });

  it('loads older pages', async () => {
    mockList
      .mockResolvedValueOnce({ items: [alert()], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [alert({ id: 'bbbbbbbbbbbbbbbbbbbbbbb9', type: 'HIGH_TEMP', severity: 'warning' })], nextCursor: null });
    await renderWithProviders(<AlertsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Load older alerts' }));
    expect(await screen.findByText('Heat warning')).toBeOnTheScreen();
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));
  });
});
