/**
 * A simulated Xeno Garden device speaking the provisioning protocol — used for demos without
 * hardware (flag `demoProvisioning`) and for tests. Behaves like the firmware:
 *  • password "wrong…" or empty password on a secured network → wifi_failed: wrong_password
 *  • SSID "NoInternet" → wifi_failed: no_internet
 */
import {
  cloudCredsPayload,
  FrameAssembler,
  toFrames,
  type BleInfoPayload,
  type ProvisioningStatePayload,
  type WifiNetwork,
} from '@xeno/shared';
import type { FoundDevice, ProvisioningSession, ProvisioningTransport } from './types';

export const SIMULATED_DEVICE: FoundDevice = { id: 'sim-1', name: 'XenoGarden-DEMO', rssi: -42, simulated: true };

const NETWORKS: WifiNetwork[] = [
  { ssid: 'Home WiFi', rssi: -48, secure: true },
  { ssid: 'Garden Shed 2.4G', rssi: -67, secure: true },
  { ssid: 'NoInternet', rssi: -72, secure: false },
  { ssid: 'Neighbours', rssi: -86, secure: true },
];

export class MockSession implements ProvisioningSession {
  readonly simulated = true;
  private listeners = new Set<(s: ProvisioningStatePayload) => void>();
  private cloud = new FrameAssembler();
  cloudConfigured = false;
  lastWifi: { ssid: string; password: string } | null = null;

  constructor(
    private readonly info: BleInfoPayload,
    private readonly stepMs = 600,
  ) {}

  async readInfo() {
    return this.info;
  }

  async writeCloudCreds(creds: Parameters<ProvisioningSession['writeCloudCreds']>[0]) {
    // Exercise the real framing path, like the firmware would receive it.
    let msg: string | null = null;
    for (const f of toFrames(JSON.stringify(creds), 40)) msg = this.cloud.push(f);
    cloudCredsPayload.parse(JSON.parse(msg!));
    this.cloudConfigured = true;
  }

  async scanWifi() {
    await sleep(this.stepMs);
    return NETWORKS;
  }

  async writeWifiCreds(ssid: string, password: string) {
    this.lastWifi = { ssid, password };
    const net = NETWORKS.find((n) => n.ssid === ssid);
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
      this.emit({ s: 'online', ip: '192.168.1.42' });
    })();
  }

  onState(cb: (s: ProvisioningStatePayload) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async disconnect() {
    this.listeners.clear();
  }

  private emit(s: ProvisioningStatePayload) {
    this.listeners.forEach((l) => l(s));
  }
}

export class MockTransport implements ProvisioningTransport {
  constructor(
    private readonly info: BleInfoPayload = { proto: 1, hwId: 'xg-de0000000001', fw: '2.0.0-sim', claimCode: 'DEMO2345', mode: 'setup' },
    private readonly stepMs = 600,
  ) {}
  lastSession: MockSession | null = null;

  async ensureReady() {}

  scan(onFound: (d: FoundDevice) => void) {
    const timer = setTimeout(() => onFound(SIMULATED_DEVICE), this.stepMs);
    return () => clearTimeout(timer);
  }

  async connect() {
    await sleep(this.stepMs / 2);
    this.lastSession = new MockSession(this.info, this.stepMs);
    return this.lastSession;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
