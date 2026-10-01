/**
 * Simple-mode setup (implementation_plan §15, ADR-017): find every nearby Xeno device and connect
 * them all with as little typing as the OS allows.
 *
 *   discover ─► connect all (one after another)
 *                 new device:    connect → read info → claim → cloud creds → WiFi → online
 *                 rejoin device: connect → read info (mine?) → WiFi → online
 *
 * WiFi is chosen automatically: the network that worked for the previous device, else the phone's
 * own WiFi (if the device can see it and we know its password), else any visible network we have
 * a saved password for. Only when none fit does it ask — once — and the answer is remembered
 * (only after the device proved the password works).
 *
 * Framework-agnostic and fully testable with the mock transport, like onboarding/flow.ts.
 */
import {
  BLE,
  nextDefaultDeviceName,
  type ClaimResponse,
  type DevicePublic,
  type WifiFailureReason,
  type WifiNetwork,
} from '@xeno/shared';
import { BleError, type FoundDevice, type ProvisioningSession, type ProvisioningTransport } from '@/lib/ble/types';

export type ItemStatus =
  | 'found'
  | 'connecting'
  | 'claiming'
  | 'wifi'
  | 'joining'
  | 'confirming'
  | 'online'
  | 'waiting'
  | 'failed'
  | 'skipped';

export interface SetupItem {
  /** BLE id (unique per phone). */
  id: string;
  bleName: string;
  rssi: number | null;
  simulated: boolean;
  /** What the user sees: "Xeno 1", or the existing name for a device that is already theirs. */
  label: string;
  /** `rejoin` = already in this garden and just needs WiFi again. */
  kind: 'new' | 'rejoin';
  status: ItemStatus;
  /** Plain-language progress or problem. */
  detail: string | null;
  deviceId: string | null;
}

export interface WifiRequest {
  itemId: string;
  label: string;
  /** Networks the device can see, strongest first. */
  networks: WifiNetwork[];
  /** Pre-selected network name. */
  suggested: string | null;
  reason: 'first_time' | 'wrong_password' | 'phone_network_not_visible';
  /** The phone's own network, when known (for the "can't see your WiFi" explanation). */
  phoneSsid: string | null;
}

export interface AutoSetupState {
  phase: 'idle' | 'scanning' | 'running' | 'done';
  items: SetupItem[];
  wifiRequest: WifiRequest | null;
  /** Problems that stop everything (Bluetooth off, permission refused). */
  error: { title: string; message: string } | null;
}

export interface AutoSetupDeps {
  transport: ProvisioningTransport;
  claim: (hardwareId: string, claimCode: string) => Promise<ClaimResponse>;
  getDevice: (id: string) => Promise<DevicePublic>;
  /** The devices already in this garden (from the query cache). */
  myDevices: () => DevicePublic[];
  /** The phone's current WiFi name, or null. */
  phoneWifi: () => Promise<string | null>;
  vault: {
    get(ssid: string): Promise<string | null>;
    save(ssid: string, password: string): Promise<void>;
    forget(ssid: string): Promise<void>;
  };
  timing?: Partial<{ joinTimeoutMs: number; confirmTimeoutMs: number; pollMs: number }>;
}

interface Creds {
  ssid: string;
  password: string;
}

type JoinResult =
  | { ok: true }
  | { ok: false; reason: WifiFailureReason | 'cloud_failed' | 'bluetooth'; wifiOk: boolean };

const MAX_PASSWORD_TRIES = 3;

/** "Xeno-AB12" → "ab12": matches the last 4 hex digits of a hardware id. */
const nameSuffix = (bleName: string) =>
  bleName.startsWith(BLE.deviceNamePrefix) ? bleName.slice(BLE.deviceNamePrefix.length).toLowerCase() : null;

function failureText(reason: WifiFailureReason | 'cloud_failed' | 'bluetooth', ssid: string): string {
  switch (reason) {
    case 'wrong_password':
      return `The password for “${ssid}” didn’t work.`;
    case 'ssid_not_found':
      return `Can’t see “${ssid}”. Move the device closer to your router and retry.`;
    case 'no_internet':
      return `“${ssid}” has no internet right now. Retry, or pick another network.`;
    case 'cloud_failed':
      return `Joined “${ssid}” but couldn’t reach Xeno Garden. Some networks block devices — try home WiFi or a phone hotspot.`;
    case 'timeout':
      return 'WiFi took too long. Move the device closer to your router and retry.';
    case 'bluetooth':
      return 'Lost the Bluetooth connection. Move closer and retry.';
    default:
      return 'Couldn’t connect to WiFi. Please retry.';
  }
}

function errorText(err: unknown): string {
  if (err instanceof BleError) {
    return err.code === 'connect_failed' ? 'Couldn’t connect. Move closer to the device and retry.' : err.message;
  }
  const e = err as { code?: string; message?: string };
  if (e?.code === 'DEVICE_ALREADY_CLAIMED') return 'This device belongs to another garden. Its owner must remove it first.';
  if (e?.code === 'NETWORK' || e?.code === 'TIMEOUT') return 'Your phone is offline. Connect to the internet and retry.';
  return 'Something went wrong. Please retry.';
}

export class AutoSetup {
  private state: AutoSetupState = { phase: 'idle', items: [], wifiRequest: null, error: null };
  private listeners = new Set<() => void>();
  private stopScan: (() => void) | null = null;
  private session: ProvisioningSession | null = null;
  private pendingWifi: ((c: Creds | null) => void) | null = null;
  /** The network that worked for the previous device in this run. */
  private lastGood: Creds | null = null;
  private phoneSsid: string | null | undefined;
  private disposed = false;
  private readonly t: Required<NonNullable<AutoSetupDeps['timing']>>;

  constructor(private readonly deps: AutoSetupDeps) {
    this.t = { joinTimeoutMs: 45_000, confirmTimeoutMs: 30_000, pollMs: 1500, ...deps.timing };
  }

  getState = () => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<AutoSetupState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private update(id: string, patch: Partial<SetupItem>) {
    this.set({ items: this.state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }

  private item(id: string) {
    return this.state.items.find((i) => i.id === id);
  }

  // ── discovery ──────────────────────────────────────────────────────────────

  /** Starts (or restarts) looking for nearby devices. May show the OS permission prompt. */
  async discover() {
    if (this.state.phase === 'running') return;
    this.set({ error: null });
    try {
      await this.deps.transport.ensureReady();
    } catch (err) {
      const e = err instanceof BleError ? err : new BleError('unsupported', String(err));
      this.set({
        phase: 'idle',
        error: {
          title: e.code === 'bluetooth_off' ? 'Turn on Bluetooth' : 'Bluetooth needed',
          message: e.message,
        },
      });
      return;
    }
    this.stopScan?.();
    this.set({ phase: 'scanning' });
    this.stopScan = this.deps.transport.scan((d) => this.onFound(d));
  }

  stopDiscovery() {
    this.stopScan?.();
    this.stopScan = null;
    if (this.state.phase === 'scanning') this.set({ phase: this.state.items.length ? 'done' : 'idle' });
  }

  private onFound(d: FoundDevice) {
    if (this.item(d.id)) {
      this.update(d.id, { rssi: d.rssi });
      return;
    }
    const mine = this.deps.myDevices();
    const suffix = nameSuffix(d.name);
    const existing = suffix ? mine.find((m) => m.hardwareId.endsWith(suffix)) : undefined;
    // Predict the name the server will give ("Xeno 3" if Xeno 1–2 exist), so it never changes.
    const label =
      existing?.name ??
      nextDefaultDeviceName([...mine.map((m) => m.name), ...this.state.items.filter((i) => i.kind === 'new').map((i) => i.label)]);
    const item: SetupItem = {
      id: d.id,
      bleName: d.name,
      rssi: d.rssi,
      simulated: !!d.simulated,
      label,
      kind: existing ? 'rejoin' : 'new',
      status: 'found',
      detail: existing ? 'Needs WiFi again' : 'Ready to connect',
      deviceId: existing?.id ?? null,
    };
    this.set({ items: [...this.state.items, item] });
  }

  // ── connecting ─────────────────────────────────────────────────────────────

  /** Connects every found (or failed) device, one after another. */
  async connectAll() {
    if (this.state.phase === 'running') return;
    this.stopScan?.();
    this.stopScan = null;
    this.set({ phase: 'running', error: null });
    let next: SetupItem | undefined;
    while (!this.disposed && (next = this.state.items.find((i) => i.status === 'found'))) {
      await this.setupOne(next.id);
    }
    this.set({ phase: 'done', wifiRequest: null });
  }

  /** Retry one device after a failure. */
  async retry(id: string) {
    const i = this.item(id);
    if (!i || (i.status !== 'failed' && i.status !== 'waiting')) return;
    this.update(id, { status: 'found', detail: 'Ready to connect' });
    await this.connectAll();
  }

  /** Answer to a WiFi request (password '' for open networks). */
  provideWifi(ssid: string, password: string) {
    const resolve = this.pendingWifi;
    this.pendingWifi = null;
    this.set({ wifiRequest: null });
    resolve?.({ ssid: ssid.trim(), password });
  }

  cancelWifi() {
    const resolve = this.pendingWifi;
    this.pendingWifi = null;
    this.set({ wifiRequest: null });
    resolve?.(null);
  }

  private async setupOne(id: string) {
    this.update(id, { status: 'connecting', detail: 'Connecting…' });
    let session: ProvisioningSession | null = null;
    try {
      session = await this.deps.transport.connect(id);
      this.session = session;
      const info = await session.readInfo();
      const mine = this.deps.myDevices().find((d) => d.hardwareId === info.hwId);

      if (info.mode === 'rejoin') {
        if (!mine) {
          this.update(id, { status: 'skipped', detail: 'This device belongs to another garden.' });
          return;
        }
        this.update(id, { kind: 'rejoin', label: mine.name, deviceId: mine.id });
      } else {
        this.update(id, { status: 'claiming', detail: 'Adding to your garden…' });
        const claim = await this.deps.claim(info.hwId, info.claimCode);
        await session.writeCloudCreds({
          h: claim.mqtt.host,
          p: claim.mqtt.port,
          t: claim.mqtt.tls,
          u: claim.mqtt.username,
          pw: claim.mqtt.password,
        });
        this.update(id, { label: claim.device.name, deviceId: claim.device.id, kind: 'new' });
      }

      this.update(id, { status: 'wifi', detail: 'Looking for WiFi…' });
      const networks = await session.scanWifi();
      let creds = await this.pickWifi(networks);
      let reason: WifiRequest['reason'] = 'first_time';
      for (let tries = 0; ; tries++) {
        if (!creds) {
          creds = await this.askWifi(this.item(id)!, networks, reason);
          if (!creds) {
            this.update(id, { status: 'failed', detail: 'Setup paused. Tap retry when you’re ready.' });
            return;
          }
        }
        this.update(id, { status: 'joining', detail: `Joining “${creds.ssid}”…` });
        const res = await this.join(session, creds);
        if (res.ok) break;
        if (res.wifiOk || res.reason !== 'wrong_password') {
          if (res.wifiOk) await this.remember(creds);
          this.update(id, { status: 'failed', detail: failureText(res.reason, creds.ssid) });
          return;
        }
        // Wrong password: forget it everywhere and ask again (a few times at most).
        await this.deps.vault.forget(creds.ssid).catch(() => undefined);
        if (this.lastGood?.ssid === creds.ssid) this.lastGood = null;
        if (tries + 1 >= MAX_PASSWORD_TRIES) {
          this.update(id, { status: 'failed', detail: failureText('wrong_password', creds.ssid) });
          return;
        }
        reason = 'wrong_password';
        creds = null;
      }
      // `creds` is set here: the loop only breaks after a successful join.
      await this.remember(creds!);

      const deviceId = this.item(id)?.deviceId;
      if (deviceId && !session.simulated) {
        this.update(id, { status: 'confirming', detail: 'Checking in…' });
        if (!(await this.waitOnline(deviceId))) {
          this.update(id, {
            status: 'waiting',
            detail: 'On WiFi — it will appear in your garden in a minute.',
          });
          return;
        }
      }
      this.update(id, { status: 'online', detail: 'Connected' });
    } catch (err) {
      this.update(id, { status: 'failed', detail: errorText(err) });
    } finally {
      await session?.disconnect().catch(() => undefined);
      if (this.session === session) this.session = null;
    }
  }

  private async remember(c: Creds) {
    this.lastGood = c;
    if (c.password) await this.deps.vault.save(c.ssid, c.password).catch(() => undefined);
  }

  private async phone(): Promise<string | null> {
    if (this.phoneSsid === undefined) this.phoneSsid = await this.deps.phoneWifi().catch(() => null);
    return this.phoneSsid;
  }

  /** Chooses WiFi without asking, or null when the user has to type a password. */
  private async pickWifi(networks: WifiNetwork[]): Promise<Creds | null> {
    const visible = new Map(networks.map((n) => [n.ssid, n]));
    if (this.lastGood && visible.has(this.lastGood.ssid)) return this.lastGood;

    const phone = await this.phone();
    if (phone && visible.has(phone)) {
      if (!visible.get(phone)!.secure) return { ssid: phone, password: '' };
      const pw = await this.deps.vault.get(phone).catch(() => null);
      return pw !== null ? { ssid: phone, password: pw } : null; // ask for the phone's network
    }
    for (const n of networks) {
      const pw = await this.deps.vault.get(n.ssid).catch(() => null);
      if (pw !== null) return { ssid: n.ssid, password: pw };
    }
    return null;
  }

  private async askWifi(item: SetupItem, networks: WifiNetwork[], reason: WifiRequest['reason']): Promise<Creds | null> {
    const phone = await this.phone();
    const phoneVisible = !!phone && networks.some((n) => n.ssid === phone);
    const suggested = phoneVisible ? phone : (networks[0]?.ssid ?? null);
    this.set({
      wifiRequest: {
        itemId: item.id,
        label: item.label,
        networks,
        suggested,
        reason: reason === 'first_time' && phone && !phoneVisible ? 'phone_network_not_visible' : reason,
        phoneSsid: phone,
      },
    });
    return new Promise<Creds | null>((resolve) => {
      this.pendingWifi = resolve;
    });
  }

  private join(s: ProvisioningSession, c: Creds): Promise<JoinResult> {
    return new Promise<JoinResult>((resolve) => {
      let done = false;
      let wifiOk = false;
      const finish = (r: JoinResult) => {
        if (done) return;
        done = true;
        off();
        clearTimeout(timer);
        resolve(r);
      };
      const off = s.onState((st) => {
        if (st.s === 'connecting_cloud') wifiOk = true;
        if (st.s === 'online') finish({ ok: true });
        else if (st.s === 'wifi_failed') finish({ ok: false, reason: st.r ?? 'unknown', wifiOk: false });
        else if (st.s === 'cloud_failed') finish({ ok: false, reason: 'cloud_failed', wifiOk: true });
      });
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout', wifiOk }), this.t.joinTimeoutMs);
      s.writeWifiCreds(c.ssid, c.password).catch(() => finish({ ok: false, reason: 'bluetooth', wifiOk: false }));
    });
  }

  private async waitOnline(id: string): Promise<boolean> {
    const deadline = Date.now() + this.t.confirmTimeoutMs;
    while (Date.now() < deadline && !this.disposed) {
      const d = await this.deps.getDevice(id).catch(() => null);
      if (d?.online) return true;
      await new Promise((r) => setTimeout(r, this.t.pollMs));
    }
    return false;
  }

  async dispose() {
    this.cancelWifi();
    this.stopScan?.();
    this.stopScan = null;
    this.disposed = true;
    await this.session?.disconnect().catch(() => undefined);
    this.session = null;
    this.listeners.clear();
  }
}

/** Summary helpers for the UI. */
export const isFinished = (i: SetupItem) => i.status === 'online' || i.status === 'waiting' || i.status === 'skipped';
export const isBusy = (i: SetupItem) =>
  i.status === 'connecting' || i.status === 'claiming' || i.status === 'wifi' || i.status === 'joining' || i.status === 'confirming';
