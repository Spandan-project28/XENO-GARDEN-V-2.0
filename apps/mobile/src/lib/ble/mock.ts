/**
 * A simulated Xeno Garden device speaking the provisioning protocol — used for demos without
 * hardware (flag `demoProvisioning`) and for tests. Behaves like the firmware:
 *  • password "wrong…" or empty password on a secured network → wifi_failed: wrong_password
 *  • SSID "NoInternet" → wifi_failed: no_internet
 *  • rejoin mode (already set up, lost its WiFi) → no claim code, cloud credentials refused
 */
import {
  cloudCredsPayload,
  FrameAssembler,
  toFrames,
  type BleInfoPayload,
  type CloudCredsPayload,
  type ProvisioningStatePayload,
  type WifiNetwork,
} from '@xeno/shared';
import type { FoundDevice, ProvisioningSession, ProvisioningTransport } from './types';

/**
 * Dev "virtual radio": hands what a real device would have received to the simulator, which then
 * runs a matching virtual device against the real broker (apps/simulator/src/bridge.ts).
 */
export type MockBridge = (body: { hwId: string; cloud: CloudCredsPayload; ssid: string }) => Promise<void>;

export interface MockDeviceSpec {
  found: FoundDevice;
  info: BleInfoPayload;
  /** Networks this device can see (defaults to MOCK_NETWORKS). */
  networks?: WifiNetwork[];
}

const demoInfo = (n: number, claimCode: string): BleInfoPayload => ({
  proto: 1,
  hwId: `xg-de00000000${String(n).padStart(2, '0')}`,
  fw: '2.1.0-sim',
  claimCode,
  mode: 'setup',
});

/** Two simulated devices in setup mode, as they'd appear fresh out of the box. */
export const SIMULATED_DEVICES: MockDeviceSpec[] = [
  { found: { id: 'sim-1', name: 'Xeno-DEM1', rssi: -42, simulated: true }, info: demoInfo(1, 'DEMX2345') },
  { found: { id: 'sim-2', name: 'Xeno-DEM2', rssi: -55, simulated: true }, info: demoInfo(2, 'DEMX2346') },
];
export const SIMULATED_DEVICE: FoundDevice = SIMULATED_DEVICES[0]!.found;

export const MOCK_NETWORKS: WifiNetwork[] = [
  { ssid: 'Home WiFi', rssi: -48, secure: true },
  { ssid: 'Garden Shed 2.4G', rssi: -67, secure: true },
  { ssid: 'NoInternet', rssi: -72, secure: false },
  { ssid: 'Neighbours', rssi: -86, secure: true },
];

export class MockSession implements ProvisioningSession {
  readonly simulated = true;
  private listeners = new Set<(s: ProvisioningStatePayload) => void>();
  private cloud = new FrameAssembler();
  /** Rejoin-mode devices already have their cloud credentials. */
  cloudConfigured: boolean;
  cloudCreds: CloudCredsPayload | null = null;
  lastWifi: { ssid: string; password: string } | null = null;
  disconnected = false;

  constructor(
    private readonly info: BleInfoPayload,
    private readonly stepMs = 600,
    private readonly networks: WifiNetwork[] = MOCK_NETWORKS,
    private readonly bridge: MockBridge | null = null,
  ) {
    this.cloudConfigured = info.mode === 'rejoin';
  }

  async readInfo() {
    return this.info;
  }

  async writeCloudCreds(creds: Parameters<ProvisioningSession['writeCloudCreds']>[0]) {
    if (this.info.mode === 'rejoin') throw new Error('cloud credentials are refused in rejoin mode');
    // Exercise the real framing path, like the firmware would receive it.
    let msg: string | null = null;
    for (const f of toFrames(JSON.stringify(creds), 40)) msg = this.cloud.push(f);
    this.cloudCreds = cloudCredsPayload.parse(JSON.parse(msg!));
    this.cloudConfigured = true;
  }

  async scanWifi() {
    await sleep(this.stepMs);
    return this.networks;
  }

  async writeWifiCreds(ssid: string, password: string) {
    this.lastWifi = { ssid, password };
    const net = this.networks.find((n) => n.ssid === ssid);
    void (async () => {
      this.emit({ s: 'connecting_wifi' });
      await sleep(this.stepMs);
      if (net?.secure && (!password || password.toLowerCase().startsWith('wrong'))) {
        return this.emit({ s: 'wifi_failed', r: 'wrong_password' });
      }
      if (!net && ssid !== 'Hidden Garden') return this.emit({ s: 'wifi_failed', r: 'ssid_not_found' });
      if (ssid === 'NoInternet') return this.emit({ s: 'wifi_failed', r: 'no_internet' });
      this.emit({ s: 'connecting_cloud', ip: '192.168.1.42' });
      await sleep(this.stepMs);
      if (!this.cloudConfigured) return this.emit({ s: 'cloud_failed' });
      if (this.bridge && this.cloudCreds) {
        try {
          await this.bridge({ hwId: this.info.hwId, cloud: this.cloudCreds, ssid });
        } catch {
          return this.emit({ s: 'cloud_failed' });
        }
      }
      this.emit({ s: 'online', ip: '192.168.1.42' });
    })();
  }

  onState(cb: (s: ProvisioningStatePayload) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async disconnect() {
    this.disconnected = true;
    this.listeners.clear();
  }

  private emit(s: ProvisioningStatePayload) {
    this.listeners.forEach((l) => l(s));
  }
}

export class MockTransport implements ProvisioningTransport {
  constructor(
    private readonly devices: MockDeviceSpec[] = [SIMULATED_DEVICES[0]!],
    private readonly stepMs = 600,
    /** Simulated devices that are already set up stop advertising (like the real firmware). */
    private readonly isSetUp: (hardwareId: string) => boolean = () => false,
    private readonly bridge: MockBridge | null = null,
  ) {}
  lastSession: MockSession | null = null;
  /** Every session opened, per device id (tests inspect what each device received). */
  readonly sessions = new Map<string, MockSession>();

  async ensureReady() {}

  async canScanQuietly() {
    return true;
  }

  /** Devices appear one after another, like real advertisements. */
  scan(onFound: (d: FoundDevice) => void) {
    const timers = this.devices.map((d, i) =>
      setTimeout(() => {
        if (!this.isSetUp(d.info.hwId)) onFound(d.found);
      }, this.stepMs * (i + 1)),
    );
    return () => timers.forEach(clearTimeout);
  }

  async connect(id: string = this.devices[0]!.found.id) {
    const spec = this.devices.find((d) => d.found.id === id);
    if (!spec) throw new Error(`unknown simulated device ${id}`);
    await sleep(this.stepMs / 2);
    this.lastSession = new MockSession(spec.info, this.stepMs, spec.networks, this.bridge);
    this.sessions.set(id, this.lastSession);
    return this.lastSession;
  }

  has(id: string) {
    return this.devices.some((d) => d.found.id === id);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
