import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { makeDevice } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { HistoryScreen } from './HistoryScreen';
import { computeRange, timeFormatters } from './ranges';

const mockReadings = jest.fn();
const mockList = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      devices: {
        list: () => mockList(),
        readings: (id: string, q: unknown) => mockReadings(id, q),
        pumpEvents: async () => [
          {
            id: 'e1',
            deviceId: 'x',
            source: 'manual',
            reason: 'manual',
            stopReason: 'max_runtime',
            startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
            endedAt: new Date(Date.now() - 2 * 3600_000 + 600_000).toISOString(),
            durationSec: 600,
          },
        ],
      },
    },
  };
});

const response = (n: number) => ({
  resolution: '5m',
  from: '',
  to: '',
  points: Array.from({ length: n }, (_, i) => ({
    ts: new Date(Date.now() - (n - i) * 300_000).toISOString(),
    soilMoisture: 30 + (i % 10),
    temperature: 24,
    humidity: 60,
    rain: 0,
    pump: 0,
  })),
  stats: { soilMoistureAvg: 34.5, temperatureAvg: 24, humidityAvg: 60, pumpOnSec: 600, samples: n },
});

beforeEach(() => {
  mockReadings.mockReset();
  mockList.mockResolvedValue([makeDevice(), makeDevice({ id: 'aaaaaaaaaaaaaaaaaaaaaaa2', name: 'Herbs' })]);
});

describe('ranges', () => {
  it('computes real, aligned windows', () => {
    const now = Date.parse('2026-05-01T10:03:00Z');
    const r = computeRange('7d', now);
    expect(r.toIso).toBe('2026-05-01T10:05:00.000Z');
    expect(r.to - r.from).toBe(7 * 24 * 3600_000);
  });
  it('formats axis labels', () => {
    expect(typeof timeFormatters('24h').axis(Date.now())).toBe('string');
  });
});

describe('HistoryScreen', () => {
  it('queries the real time range and renders the chart and sessions', async () => {
    mockReadings.mockResolvedValue(response(60));
    await renderWithProviders(<HistoryScreen />);
    expect(await screen.findByTestId('history-chart')).toBeOnTheScreen();
    const [, q] = mockReadings.mock.calls[0]!;
    expect(Date.parse(q.to) - Date.parse(q.from)).toBe(24 * 3600_000);
    expect(q.tz).toBeTruthy();
    expect(screen.getByLabelText('Avg soil: 35%')).toBeOnTheScreen();
    expect(screen.getByText('Watering sessions (1)')).toBeOnTheScreen();
    expect(screen.getByText(/Manual · 10 min · stopped: max runtime/)).toBeOnTheScreen();
    expect(screen.getByText('Shaded = pump running')).toBeOnTheScreen();
  });

  it('changes range and device', async () => {
    mockReadings.mockResolvedValue(response(20));
    await renderWithProviders(<HistoryScreen />);
    await screen.findByTestId('history-chart');
    await fireEvent.press(screen.getByTestId('chip-30d'));
    await waitFor(() => {
      const last = mockReadings.mock.calls.at(-1)!;
      expect(Date.parse(last[1].to) - Date.parse(last[1].from)).toBe(30 * 24 * 3600_000);
    });
    await fireEvent.press(screen.getByTestId('chip-aaaaaaaaaaaaaaaaaaaaaaa2'));
    await waitFor(() => expect(mockReadings.mock.calls.at(-1)![0]).toBe('aaaaaaaaaaaaaaaaaaaaaaa2'));
  });

  it('shows an empty state when there are no readings', async () => {
    mockReadings.mockResolvedValue({ ...response(0), points: [] });
    await renderWithProviders(<HistoryScreen />);
    expect(await screen.findByText('No readings in this period')).toBeOnTheScreen();
  });
});
