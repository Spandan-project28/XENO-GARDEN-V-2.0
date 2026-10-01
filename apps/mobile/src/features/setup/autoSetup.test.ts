import { BleError } from '@/lib/ble/types';
import { MOCK_NETWORKS, MockTransport, SIMULATED_DEVICES, type MockDeviceSpec } from '@/lib/ble/mock';
import { makeDevice } from '@/test/fixtures';
import { AutoSetup, type AutoSetupDeps } from './autoSetup';

const MQTT = { host: 'mqtt.example.com', port: 8883, tls: true, password: 'p'.repeat(32) };

function memoryVault(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    map: m,
    get: async (s: string) => m.get(s) ?? null,
    save: async (s: string, p: string) => void m.set(s, p),
    forget: async (s: string) => void m.delete(s),
  };
}

function setup(opts: {
  devices?: MockDeviceSpec[];
  vault?: Record<string, string>;
  phone?: string | null;
  mine?: ReturnType<typeof makeDevice>[];
}) {
  const transport = new MockTransport(opts.devices ?? SIMULATED_DEVICES, 2);
  const vault = memoryVault(opts.vault);
  const mine = [...(opts.mine ?? [])];
  const claimed: string[] = [];
  const deps: AutoSetupDeps = {
    transport,
    claim: async (hw) => {
      claimed.push(hw);
      const n = mine.length + 1;
      const device = makeDevice({ id: `dddddddddddddddddddddd${String(n).padStart(2, '0')}`, hardwareId: hw, name: `Xeno ${n}`, online: false });
      mine.push(device);
      return { device, mqtt: { ...MQTT, username: hw } };
    },
    getDevice: async (id) => ({ ...mine.find((d) => d.id === id)!, online: true }),
    myDevices: () => mine,
    phoneWifi: async () => (opts.phone === undefined ? 'Home WiFi' : opts.phone),
    vault,
    timing: { joinTimeoutMs: 1000, confirmTimeoutMs: 100, pollMs: 2 },
  };
  const auto = new AutoSetup(deps);
  return { auto, transport, vault, claimed, mine };
}

async function discoverAll(auto: AutoSetup, n: number) {
  await auto.discover();
  await waitFor(() => auto.getState().items.length === n);
  auto.stopDiscovery();
}

async function waitFor(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe('AutoSetup', () => {
  it('finds two devices, names them Xeno 1 and Xeno 2, and connects both with zero prompts', async () => {
    const { auto, transport, claimed } = setup({ vault: { 'Home WiFi': 'garden-pass' } });
    await discoverAll(auto, 2);
    expect(auto.getState().items.map((i) => [i.label, i.kind, i.status])).toEqual([
      ['Xeno 1', 'new', 'found'],
      ['Xeno 2', 'new', 'found'],
    ]);
    await auto.connectAll();
    const s = auto.getState();
    expect(s.phase).toBe('done');
    expect(s.wifiRequest).toBeNull();
    expect(s.items.map((i) => [i.label, i.status])).toEqual([
      ['Xeno 1', 'online'],
      ['Xeno 2', 'online'],
    ]);
    expect(claimed).toEqual(['xg-de0000000001', 'xg-de0000000002']);
    for (const id of ['sim-1', 'sim-2']) {
      expect(transport.sessions.get(id)?.lastWifi).toEqual({ ssid: 'Home WiFi', password: 'garden-pass' });
      expect(transport.sessions.get(id)?.disconnected).toBe(true);
    }
  });

  it('asks once for the phone’s WiFi, then reuses it for the next device and remembers it', async () => {
    const { auto, transport, vault } = setup({});
    await discoverAll(auto, 2);
    const run = auto.connectAll();
    await waitFor(() => auto.getState().wifiRequest !== null);
    expect(auto.getState().wifiRequest).toMatchObject({ label: 'Xeno 1', suggested: 'Home WiFi', reason: 'first_time' });
    auto.provideWifi('Home WiFi', 'garden-pass');
    await run;
    expect(auto.getState().items.every((i) => i.status === 'online')).toBe(true);
    expect(transport.sessions.get('sim-2')?.lastWifi?.password).toBe('garden-pass');
    expect(vault.map.get('Home WiFi')).toBe('garden-pass');
  });

  it('a wrong saved password is forgotten and asked again; only the working one is saved', async () => {
    const { auto, vault } = setup({ devices: [SIMULATED_DEVICES[0]!], vault: { 'Home WiFi': 'wrong-old' } });
    await discoverAll(auto, 1);
    const run = auto.connectAll();
    await waitFor(() => auto.getState().wifiRequest !== null);
    expect(auto.getState().wifiRequest?.reason).toBe('wrong_password');
    expect(vault.map.has('Home WiFi')).toBe(false);
    auto.provideWifi('Home WiFi', 'new-pass');
    await run;
    expect(auto.getState().items[0]?.status).toBe('online');
    expect(vault.map.get('Home WiFi')).toBe('new-pass');
  });

  it('explains when the device can’t see the phone’s WiFi (e.g. 5 GHz) and suggests the strongest it can', async () => {
    const { auto } = setup({ devices: [SIMULATED_DEVICES[0]!], phone: 'Home 5G' });
    await discoverAll(auto, 1);
    const run = auto.connectAll();
    await waitFor(() => auto.getState().wifiRequest !== null);
    expect(auto.getState().wifiRequest).toMatchObject({
      reason: 'phone_network_not_visible',
      phoneSsid: 'Home 5G',
      suggested: MOCK_NETWORKS[0]!.ssid,
    });
    auto.cancelWifi();
    await run;
    expect(auto.getState().items[0]).toMatchObject({ status: 'failed' });
  });

  it('uses another saved network the device can see when the phone is on mobile data', async () => {
    const { auto, transport } = setup({ devices: [SIMULATED_DEVICES[0]!], phone: null, vault: { 'Garden Shed 2.4G': 'shed-pass' } });
    await discoverAll(auto, 1);
    await auto.connectAll();
    expect(auto.getState().items[0]?.status).toBe('online');
    expect(transport.sessions.get('sim-1')?.lastWifi).toEqual({ ssid: 'Garden Shed 2.4G', password: 'shed-pass' });
  });

  it('rejoin: an existing device that lost its WiFi only gets new WiFi (no claim)', async () => {
    const mineDevice = makeDevice({ id: 'eeeeeeeeeeeeeeeeeeeeeee1', hardwareId: 'xg-3c71bf12ab34', name: 'Tomatoes' });
    const rejoin: MockDeviceSpec = {
      found: { id: 'ble-ab34', name: 'Xeno-AB34', rssi: -50 },
      info: { proto: 1, hwId: 'xg-3c71bf12ab34', fw: '2.1.0', claimCode: '', mode: 'rejoin' },
    };
    const { auto, claimed, transport } = setup({ devices: [rejoin], mine: [mineDevice], vault: { 'Home WiFi': 'garden-pass' } });
    await discoverAll(auto, 1);
    expect(auto.getState().items[0]).toMatchObject({ label: 'Tomatoes', kind: 'rejoin', detail: 'Needs WiFi again' });
    await auto.connectAll();
    expect(auto.getState().items[0]?.status).toBe('online');
    expect(claimed).toEqual([]);
    expect(transport.sessions.get('ble-ab34')?.cloudConfigured).toBe(true);
  });

  it('skips a stranger’s device in rejoin mode without touching it', async () => {
    const stranger: MockDeviceSpec = {
      found: { id: 'ble-9999', name: 'Xeno-9999', rssi: -70 },
      info: { proto: 1, hwId: 'xg-00000000ffff', fw: '2.1.0', claimCode: '', mode: 'rejoin' },
    };
    const { auto, transport } = setup({ devices: [stranger, SIMULATED_DEVICES[0]!], vault: { 'Home WiFi': 'pw' } });
    await discoverAll(auto, 2);
    await auto.connectAll();
    const [a, b] = auto.getState().items;
    expect(a).toMatchObject({ status: 'skipped', detail: 'This device belongs to another garden.' });
    expect(transport.sessions.get('ble-9999')?.lastWifi).toBeNull();
    expect(b?.status).toBe('online');
  });

  it('a failure on one device never blocks the others, and retry works', async () => {
    const offlineNet: MockDeviceSpec = {
      ...SIMULATED_DEVICES[0]!,
      networks: [{ ssid: 'NoInternet', rssi: -40, secure: false }],
    };
    const homeOnly: MockDeviceSpec = { ...SIMULATED_DEVICES[1]!, networks: [{ ssid: 'Home WiFi', rssi: -50, secure: true }] };
    const { auto } = setup({ devices: [offlineNet, homeOnly], phone: 'NoInternet', vault: { 'Home WiFi': 'pw' } });
    await discoverAll(auto, 2);
    await auto.connectAll();
    const [a, b] = auto.getState().items;
    expect(a?.status).toBe('failed');
    expect(a?.detail).toMatch(/has no internet/);
    expect(b?.status).toBe('online');
    await auto.retry(a!.id);
    expect(auto.getState().items[0]?.status).toBe('failed');
  });

  it('predicts the next free name when the garden already has devices', async () => {
    const { auto } = setup({ mine: [makeDevice({ name: 'Xeno 1', hardwareId: 'xg-111111111111' })] });
    await discoverAll(auto, 2);
    expect(auto.getState().items.map((i) => i.label)).toEqual(['Xeno 2', 'Xeno 3']);
  });

  it('reports Bluetooth problems as a clear global error', async () => {
    const { auto, transport } = setup({});
    transport.ensureReady = async () => {
      throw new BleError('bluetooth_off', 'Turn on Bluetooth to set up your device.');
    };
    await auto.discover();
    expect(auto.getState()).toMatchObject({ phase: 'idle', error: { title: 'Turn on Bluetooth' } });
  });
});
