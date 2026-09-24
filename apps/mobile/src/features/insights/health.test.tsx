import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { HealthReport } from '@xeno/shared';
import { useLocalSearchParams } from 'expo-router';
import { makeDevice } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { PlantHealthScreen } from './PlantHealthScreen';

const mockGet = jest.fn();
const mockHealth = jest.fn();
const mockRun = jest.fn();
const mockCreatePlant = jest.fn();
const mockUpdateDevice = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      devices: { get: (id: string) => mockGet(id), update: (id: string, b: unknown) => mockUpdateDevice(id, b) },
      plants: {
        health: (id: string) => mockHealth(id),
        runHealth: (id: string) => mockRun(id),
        create: (b: unknown) => mockCreatePlant(b),
      },
    },
  };
});

const ID = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const PLANT = 'cccccccccccccccccccccccc';
const report = (over: Partial<HealthReport> = {}): HealthReport => ({
  id: 'eeeeeeeeeeeeeeeeeeeeeee1',
  plantId: PLANT,
  deviceId: ID,
  provider: 'rules',
  modelVersion: '1.0.0',
  score: 72,
  status: 'attention',
  summary: 'Mostly fine, but the soil dried out twice this week.',
  findings: [{ code: 'dry_spells', severity: 'warning', message: 'Soil stayed below target for 6 hours on Tuesday.', confidence: 0.9 }],
  window: { from: '2026-01-01T00:00:00Z', to: '2026-01-08T00:00:00Z' },
  imageUrl: null,
  createdAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: ID });
  [mockGet, mockHealth, mockRun, mockCreatePlant, mockUpdateDevice].forEach((m) => m.mockReset());
});

describe('PlantHealthScreen', () => {
  it('asks for plant details first, then links the plant to the device', async () => {
    mockGet.mockResolvedValue(makeDevice({ id: ID, plantId: null }));
    mockCreatePlant.mockResolvedValue({ id: PLANT, name: 'Tomatoes', species: 'Tomato', notes: null, photoUrl: null, deviceId: null, createdAt: '' });
    mockUpdateDevice.mockResolvedValue(makeDevice({ id: ID, plantId: PLANT }));
    mockHealth.mockResolvedValue({ latest: null, history: [] });
    await renderWithProviders(<PlantHealthScreen />);
    expect(await screen.findByText('What are you growing?')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('plant-name'), 'Tomatoes');
    await fireEvent.changeText(screen.getByTestId('plant-species'), 'Tomato');
    await fireEvent.press(screen.getByTestId('save-plant'));
    await waitFor(() => expect(mockCreatePlant).toHaveBeenCalledWith({ name: 'Tomatoes', species: 'Tomato' }));
    expect(mockUpdateDevice).toHaveBeenCalledWith(ID, { plantId: PLANT });
    expect(await screen.findByText('No health check yet')).toBeOnTheScreen();
  });

  it('shows the latest report with findings and can run a new check', async () => {
    mockGet.mockResolvedValue(makeDevice({ id: ID, plantId: PLANT }));
    mockHealth.mockResolvedValue({ latest: report(), history: [report(), report({ id: 'eeeeeeeeeeeeeeeeeeeeeee2', score: 88, status: 'healthy' })] });
    mockRun.mockResolvedValue(report({ score: 80 }));
    await renderWithProviders(<PlantHealthScreen />);
    expect(await screen.findByText('Needs attention')).toBeOnTheScreen();
    expect(screen.getByLabelText('Health score')).toHaveAccessibilityValue({ now: 72 });
    expect(screen.getByText('Soil stayed below target for 6 hours on Tuesday.')).toBeOnTheScreen();
    expect(screen.getByText(/Smart rules/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('run-health'));
    await waitFor(() => expect(mockRun).toHaveBeenCalledWith(PLANT));
    await waitFor(() => expect(mockHealth).toHaveBeenCalledTimes(2));
  });
});
