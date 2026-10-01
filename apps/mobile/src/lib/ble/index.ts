import { flags } from '@/config/flags';
import { MockTransport, SIMULATED_DEVICES } from './mock';
import { PlxTransport } from './plx';
import type { FoundDevice, ProvisioningSession, ProvisioningTransport } from './types';

export * from './types';
export { MOCK_NETWORKS, MockTransport, SIMULATED_DEVICE, SIMULATED_DEVICES, type MockDeviceSpec } from './mock';

/**
 * The transport setup uses: real Bluetooth, plus (when the demo flag is on) two simulated
 * devices in the scan list so the whole flow can be tried without hardware.
 */
export function createTransport(opts: { isSetUp?: (hardwareId: string) => boolean } = {}): ProvisioningTransport {
  const real = new PlxTransport();
  if (!flags.demoProvisioning) return real;
  const mock = new MockTransport(SIMULATED_DEVICES, 600, opts.isSetUp);
  return {
    ensureReady: () => real.ensureReady().catch(() => undefined),
    canScanQuietly: async () => true,
    scan(onFound: (d: FoundDevice) => void) {
      let stopReal: (() => void) | null = null;
      try {
        stopReal = real.scan(onFound);
      } catch {
        stopReal = null;
      }
      const stopMock = mock.scan(onFound);
      return () => {
        stopReal?.();
        stopMock();
      };
    },
    connect: (id: string): Promise<ProvisioningSession> =>
      mock.has(id) ? mock.connect(id) : real.connect(id),
  };
}
