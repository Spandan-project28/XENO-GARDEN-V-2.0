import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { renderWithProviders } from '@/test/render';
import { FirmwareRow } from './FirmwareRow';

const mockStatus = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return { ...actual, api: { devices: { firmware: () => mockStatus(), updateFirmware: () => mockUpdate() } } };
});

describe('FirmwareRow', () => {
  it('shows the version and offers an update when one is available', async () => {
    mockStatus.mockResolvedValue({ current: '2.0.0', latest: '2.1.0', updateAvailable: true });
    mockUpdate.mockResolvedValue({ cmdId: 'c1' });
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.find((x) => x.text === 'Update')?.onPress?.());
    await renderWithProviders(<FirmwareRow deviceId="d1" online />);
    expect(await screen.findByText('Version 2.1.0 is available')).toBeOnTheScreen();
    expect(screen.getByText('2.0.0')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('firmware-row'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    spy.mockRestore();
  });

  it('is informational when up to date', async () => {
    mockStatus.mockResolvedValue({ current: '2.1.0', latest: '2.1.0', updateAvailable: false });
    await renderWithProviders(<FirmwareRow deviceId="d1" online />);
    expect(await screen.findByText('Up to date')).toBeOnTheScreen();
  });
});
