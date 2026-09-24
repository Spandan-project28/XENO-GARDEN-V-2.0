/**
 * Onboarding / re-provisioning state machine (framework-agnostic, fully testable).
 *
 * intro → scanning → connecting → wifi → password → joining → naming → done
 *
 * The phone never needs the device's IP address: it hands the device WiFi + cloud credentials
 * over Bluetooth, and the device connects *out* to the cloud from whatever network it's on.
 */
import type { ClaimResponse, DevicePublic, ProvisioningState, WifiFailureReason, WifiNetwork } from '@xeno/shared';
import { BleError, type FoundDevice, type ProvisioningSession, type ProvisioningTransport } from '@/lib/ble/types';

export type Step = 'intro' | 'scanning' | 'connecting' | 'wifi' | 'password' | 'joining' | 'naming' | 'done';

export interface FlowError {
  title: string;
  message: string;
  /** Where "Try again" goes. */
  retry: Step;
}

export interface FlowState {
  step: Step;
  mode: 'add' | 'wifi';
  devices: FoundDevice[];
  scanTimedOut: boolean;
  connectStage: 'connecting' | 'claiming' | 'scanning_wifi' | null;
  networks: WifiNetwork[];
  network: WifiNetwork | null;
  progress: ProvisioningState | null;
  device: DevicePublic | null;
  error: FlowError | null;
  busy: boolean;
}

export interface FlowDeps {
  transport: ProvisioningTransport;
  claim: (hardwareId: string, claimCode: string) => Promise<ClaimResponse>;
  getDevice: (id: string) => Promise<DevicePublic>;
  rename: (id: string, name: string) => Promise<DevicePublic>;
  /** Timing knobs (tests shrink them). */
  timing?: Partial<{ scanTimeoutMs: number; joinTimeoutMs: number; confirmTimeoutMs: number; pollMs: number }>;
}

const WIFI_MESSAGES: Record<WifiFailureReason, { title: string; message: string; retry: Step }> = {
  wrong_password: { title: 'Wrong WiFi password', message: 'The device couldn’t join with that password. Check it (it’s case-sensitive) and try again.', retry: 'password' },
  ssid_not_found: { title: 'Network not found', message: 'The device can’t see that network. Move it closer to your router, or pick another network.', retry: 'wifi' },
  no_internet: { title: 'No internet on this WiFi', message: 'The device joined the WiFi, but it has no internet access. Try another network or check your router.', retry: 'wifi' },
  timeout: { title: 'WiFi took too long', message: 'The device couldn’t connect in time. Move it closer to the router and try again.', retry: 'password' },
  unknown: { title: 'Couldn’t connect to WiFi', message: 'Something went wrong while joining the network. Please try again.', retry: 'password' },
};

export const initialState = (mode: 'add' | 'wifi'): FlowState => ({
  step: 'intro',
  mode,
  devices: [],
  scanTimedOut: false,
  connectStage: null,
  networks: [],
  network: null,
  progress: null,
  device: null,
  error: null,
  busy: false,
});

export class ProvisioningFlow {
  private state: FlowState;
  private listeners = new Set<() => void>();
  private session: ProvisioningSession | null = null;
  private stopScan: (() => void) | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly t: Required<NonNullable<FlowDeps['timing']>>;

  constructor(
    private readonly deps: FlowDeps,
    mode: 'add' | 'wifi' = 'add',
  ) {
    this.state = initialState(mode);
    this.t = { scanTimeoutMs: 15_000, joinTimeoutMs: 45_000, confirmTimeoutMs: 30_000, pollMs: 1500, ...deps.timing };
  }

  getState = () => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<FlowState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private fail(e: FlowError) {
    this.set({ error: e, busy: false });
  }

  private later(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  dismissError() {
    const retry = this.state.error?.retry;
    this.set({ error: null, ...(retry ? { step: retry } : {}) });
    if (retry === 'scanning') void this.startScan();
  }

  async startScan() {
    this.set({ busy: true, error: null });
    try {
      await this.deps.transport.ensureReady();
    } catch (err) {
      const e = err instanceof BleError ? err : new BleError('unsupported', String(err));
      return this.fail({ title: e.code === 'bluetooth_off' ? 'Bluetooth is off' : 'Bluetooth unavailable', message: e.message, retry: 'intro' });
    }
    this.stopScan?.();
    this.set({ step: 'scanning', devices: [], scanTimedOut: false, busy: false });
    this.stopScan = this.deps.transport.scan((d) => {
      if (this.state.devices.some((x) => x.id === d.id)) return;
      this.set({ devices: [...this.state.devices, d].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)) });
    });
    this.later(() => {
      if (this.state.step === 'scanning') this.set({ scanTimedOut: true });
    }, this.t.scanTimeoutMs);
  }

  async chooseDevice(d: FoundDevice) {
    this.stopScan?.();
    this.stopScan = null;
    this.set({ step: 'connecting', connectStage: 'connecting', busy: true, error: null });
    try {
      this.session = await this.deps.transport.connect(d.id);
      const info = await this.session.readInfo();
      this.set({ connectStage: 'claiming' });
      const claim = await this.deps.claim(info.hwId, info.claimCode);
      await this.session.writeCloudCreds({
        h: claim.mqtt.host,
        p: claim.mqtt.port,
        t: claim.mqtt.tls,
        u: claim.mqtt.username,
        pw: claim.mqtt.password,
      });
      this.set({ device: claim.device, connectStage: 'scanning_wifi' });
      const networks = await this.session.scanWifi();
      this.set({ step: 'wifi', networks, connectStage: null, busy: false });
    } catch (err) {
      await this.session?.disconnect().catch(() => undefined);
      this.session = null;
      this.fail(describeError(err));
    }
  }

  async rescanWifi() {
    if (!this.session) return;
    this.set({ busy: true });
    try {
      this.set({ networks: await this.session.scanWifi(), busy: false });
    } catch (err) {
      this.fail(describeError(err, 'wifi'));
    }
  }

  chooseNetwork(n: WifiNetwork) {
    this.set({ network: n, step: 'password', error: null });
    if (!n.secure) void this.join('');
  }

  backToNetworks() {
    this.set({ step: 'wifi', network: null, error: null });
  }

  /** Enter a hidden network by name. */
  chooseHiddenNetwork(ssid: string) {
    this.chooseNetwork({ ssid: ssid.trim(), rssi: -100, secure: true });
  }

  async join(password: string) {
    const s = this.session;
    const n = this.state.network;
    if (!s || !n) return;
    this.set({ step: 'joining', progress: 'connecting_wifi', busy: true, error: null });

    const outcome = await new Promise<{ ok: true } | { ok: false; error: FlowError }>((resolve) => {
      let done = false;
      const finish = (r: { ok: true } | { ok: false; error: FlowError }) => {
        if (done) return;
        done = true;
        off();
        clearTimeout(timer);
        resolve(r);
      };
      const off = s.onState((st) => {
        this.set({ progress: st.s });
        if (st.s === 'online') finish({ ok: true });
        else if (st.s === 'wifi_failed') finish({ ok: false, error: WIFI_MESSAGES[st.r ?? 'unknown'] });
        else if (st.s === 'cloud_failed') {
          finish({
            ok: false,
            error: {
              title: 'Can’t reach Xeno Garden',
              message: 'The device joined your WiFi but couldn’t reach our servers. Some networks (schools, offices) block devices; try your home network or a phone hotspot.',
              retry: 'wifi',
            },
          });
        }
      });
      const timer = this.later(() => finish({ ok: false, error: WIFI_MESSAGES.timeout }), this.t.joinTimeoutMs);
      s.writeWifiCreds(n.ssid, password).catch((err) => finish({ ok: false, error: describeError(err, 'password') }));
    });

    if (!outcome.ok) return this.fail(outcome.error);

    // The device says it's online — confirm from the cloud's side (real devices only).
    const id = this.state.device?.id;
    if (id && !s.simulated) {
      const confirmed = await this.waitOnline(id);
      if (!confirmed) {
        return this.fail({
          title: 'Almost there',
          message: 'The device is on WiFi but hasn’t checked in with the cloud yet. Give it a minute; it will appear in your garden automatically.',
          retry: 'wifi',
        });
      }
    }
    await s.disconnect().catch(() => undefined);
    this.session = null;
    this.set({ step: this.state.mode === 'wifi' ? 'done' : 'naming', busy: false });
  }

  private async waitOnline(id: string): Promise<boolean> {
    const deadline = Date.now() + this.t.confirmTimeoutMs;
    while (Date.now() < deadline) {
      const d = await this.deps.getDevice(id).catch(() => null);
      if (d?.online) {
        this.set({ device: d });
        return true;
      }
      await new Promise((r) => this.later(() => r(null), this.t.pollMs));
    }
    return false;
  }

  async finish(name: string) {
    const d = this.state.device;
    if (!d) return;
    const trimmed = name.trim();
    this.set({ busy: true });
    try {
      const updated = trimmed && trimmed !== d.name ? await this.deps.rename(d.id, trimmed) : d;
      this.set({ device: updated, step: 'done', busy: false });
    } catch (err) {
      this.fail(describeError(err, 'naming'));
    }
  }

  async dispose() {
    this.stopScan?.();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    await this.session?.disconnect().catch(() => undefined);
    this.session = null;
    this.listeners.clear();
  }
}

export function describeError(err: unknown, retry: Step = 'scanning'): FlowError {
  if (err instanceof BleError) {
    return { title: err.code === 'connect_failed' ? 'Couldn’t connect' : 'Bluetooth problem', message: err.message, retry };
  }
  const e = err as { code?: string; message?: string };
  if (e?.code === 'DEVICE_ALREADY_CLAIMED') {
    return { title: 'Device belongs to another account', message: e.message ?? 'Ask its owner to remove it first.', retry: 'scanning' };
  }
  if (e?.code === 'NETWORK' || e?.code === 'TIMEOUT') {
    return { title: 'Your phone is offline', message: 'Setup needs internet on your phone for a moment. Check your connection and try again.', retry };
  }
  return { title: 'Something went wrong', message: e?.message ?? 'Please try again.', retry };
}
