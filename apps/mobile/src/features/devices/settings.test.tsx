import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { defaultSettings } from '@xeno/shared';
import { useLocalSearchParams } from 'expo-router';
import { makeDevice } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { DeviceSettingsScreen } from './DeviceSettingsScreen';
import { diffSettings, formatSeconds, validateSettings } from './settingsForm';

const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockRename = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      devices: {
        get: (id: string) => mockGet(id),
        updateSettings: (id: string, p: unknown) => mockUpdate(id, p),
        update: (id: string, b: unknown) => mockRename(id, b),
      },
      alerts: {},
    },
  };
});

const ID = 'aaaaaaaaaaaaaaaaaaaaaaa1';
beforeEach(() => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: ID });
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockRename.mockReset();
});

describe('settings form helpers', () => {
  it('diffs only changed fields', () => {
    expect(diffSettings(defaultSettings, { ...defaultSettings, rainLockout: false, moistureLow: 25 })).toEqual({
      rainLockout: false,
      moistureLow: 25,
    });
    expect(diffSettings(defaultSettings, defaultSettings)).toEqual({});
  });
  it('validates with the shared schema', () => {
    expect(validateSettings(defaultSettings)).toBeNull();
    expect(validateSettings({ ...defaultSettings, moistureLow: 44, moistureHigh: 45 })).toMatch(/at least 5%/);
  });
  it('formats durations', () => {
    expect(formatSeconds(90)).toBe('1 min 30 s');
    expect(formatSeconds(600)).toBe('10 min');
    expect(formatSeconds(3900)).toBe('1 h 5 min');
  });
});

describe('DeviceSettingsScreen', () => {
  it('saves only the changed settings', async () => {
    const d = makeDevice({ id: ID });
    mockGet.mockResolvedValue(d);
    mockUpdate.mockResolvedValue({ ...d, desired: { ...d.desired, version: 2, settings: { ...d.desired.settings, rainLockout: false } }, syncPending: true });
    await renderWithProviders(<DeviceSettingsScreen />);
    expect(await screen.findByText('Device is up to date')).toBeOnTheScreen();
    expect(screen.queryByTestId('save-settings')).toBeNull();
    await fireEvent.press(screen.getByTestId('rain-toggle'));
    await fireEvent.press(await screen.findByTestId('save-settings'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(ID, { rainLockout: false }));
    expect(await screen.findByText('Syncing to device…')).toBeOnTheScreen();
  });

  it('explains that offline changes apply later', async () => {
    mockGet.mockResolvedValue(makeDevice({ id: ID, online: false }));
    await renderWithProviders(<DeviceSettingsScreen />);
    expect(await screen.findByText('Changes are saved and applied as soon as it reconnects.')).toBeOnTheScreen();
  });

  it('renames through the sheet', async () => {
    const d = makeDevice({ id: ID });
    mockGet.mockResolvedValue(d);
    mockRename.mockResolvedValue({ ...d, name: 'Herb garden' });
    await renderWithProviders(<DeviceSettingsScreen />);
    await fireEvent.press(await screen.findByTestId('rename-row'));
    await fireEvent.changeText(await screen.findByTestId('rename-input'), '  Herb garden ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockRename).toHaveBeenCalledWith(ID, { name: 'Herb garden' }));
  });
});
