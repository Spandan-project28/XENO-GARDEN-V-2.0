import type { ClaimResponse } from '@xeno/shared';
import { MockTransport, SIMULATED_DEVICE } from '@/lib/ble/mock';
import { BleError, type ProvisioningTransport } from '@/lib/ble/types';
import { makeDevice } from '@/test/fixtures';
import { ProvisioningFlow, type FlowDeps } from './flow';

const claimResponse = (): ClaimResponse => ({
  device: makeDevice({ id: 'dddddddddddddddddddddddd', name: 'Garden 0001', online: false }),
  mqtt: { host: 'mqtt.example.com', port: 8883, tls: true, username: 'xg-de0000000001', password: 'p'.repeat(32) },
});

const until = async (flow: ProvisioningFlow, pred: (s: ReturnType<ProvisioningFlow['getState']>) => boolean, ms = 3000) => {
  const start = Date.now();
  while (!pred(flow.getState())) {
    if (Date.now() - start > ms) throw new Error(`timeout; state=${JSON.stringify(flow.getState())}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

function setup(overrides: Partial<FlowDeps> = {}, mode: 'add' | 'wifi' = 'add') {
  const transport = new MockTransport(undefined, 10);
  const deps: FlowDeps = {
    transport,
    claim: jest.fn(async () => claimResponse()),
    getDevice: jest.fn(async () => makeDevice({ online: true })),
    rename: jest.fn(async (_id, name) => makeDevice({ name })),
    timing: { scanTimeoutMs: 50, joinTimeoutMs: 500, confirmTimeoutMs: 100, pollMs: 10 },
    ...overrides,
  };
  return { flow: new ProvisioningFlow(deps, mode), deps, transport };
}

describe('ProvisioningFlow', () => {
  it('runs the happy path: scan → claim → cloud creds → wifi → online → name', async () => {
    const { flow, deps, transport } = setup();
    await flow.startScan();
    await until(flow, (s) => s.devices.length === 1);
    expect(flow.getState().devices[0]).toEqual(SIMULATED_DEVICE);

    await flow.chooseDevice(SIMULATED_DEVICE);
    expect(deps.claim).toHaveBeenCalledWith('xg-de0000000001', 'DEMX2345');
    expect(transport.lastSession?.cloudConfigured).toBe(true);
    expect(flow.getState().step).toBe('wifi');
    expect(flow.getState().networks[0]?.ssid).toBe('Home WiFi');

    flow.chooseNetwork(flow.getState().networks[0]!);
    expect(flow.getState().step).toBe('password');
    await flow.join('correct horse');
    expect(transport.lastSession?.lastWifi).toEqual({ ssid: 'Home WiFi', password: 'correct horse' });
    expect(flow.getState().step).toBe('naming');

    await flow.finish('  Balcony  ');
    expect(deps.rename).toHaveBeenCalledWith('dddddddddddddddddddddddd', 'Balcony');
    expect(flow.getState().step).toBe('done');
    await flow.dispose();
  });

  it('explains a wrong password and lets the user retry', async () => {
    const { flow } = setup();
    await flow.startScan();
    await flow.chooseDevice(SIMULATED_DEVICE);
    flow.chooseNetwork(flow.getState().networks[0]!);
    await flow.join('wrong-password');
    expect(flow.getState().error).toMatchObject({ title: 'Wrong WiFi password', retry: 'password' });
    flow.dismissError();
    expect(flow.getState().step).toBe('password');
    await flow.join('right-password');
    expect(flow.getState().step).toBe('naming');
    await flow.dispose();
  });

  it('joins open networks immediately and reports networks without internet', async () => {
    const { flow } = setup();
    await flow.startScan();
    await flow.chooseDevice(SIMULATED_DEVICE);
    flow.chooseNetwork({ ssid: 'NoInternet', rssi: -70, secure: false });
    await until(flow, (s) => !!s.error);
    expect(flow.getState().error).toMatchObject({ title: 'No internet on this WiFi', retry: 'wifi' });
    await flow.dispose();
  });

  it('skips naming when changing WiFi on an existing device', async () => {
    const { flow } = setup({}, 'wifi');
    await flow.startScan();
    await flow.chooseDevice(SIMULATED_DEVICE);
    flow.chooseNetwork(flow.getState().networks[1]!);
    await flow.join('password123');
    expect(flow.getState().step).toBe('done');
    await flow.dispose();
  });

  it('surfaces claim conflicts with a clear message', async () => {
    const { flow } = setup({
      claim: jest.fn(async () => {
        throw Object.assign(new Error('This device is linked to another account.'), { code: 'DEVICE_ALREADY_CLAIMED' });
      }),
    });
    await flow.startScan();
    await flow.chooseDevice(SIMULATED_DEVICE);
    expect(flow.getState().error?.title).toBe('Device belongs to another account');
    await flow.dispose();
  });

  it('reports Bluetooth problems before scanning', async () => {
    const transport: ProvisioningTransport = {
      ensureReady: async () => {
        throw new BleError('bluetooth_off', 'Turn on Bluetooth to set up your device.');
      },
      scan: () => () => {},
      connect: async () => {
        throw new Error('unreachable');
      },
    };
    const { flow } = setup({ transport });
    await flow.startScan();
    expect(flow.getState()).toMatchObject({ step: 'intro', error: { title: 'Bluetooth is off' } });
    await flow.dispose();
  });

  it('flags an empty scan after the timeout', async () => {
    const transport: ProvisioningTransport = { ensureReady: async () => {}, scan: () => () => {}, connect: jest.fn() };
    const { flow } = setup({ transport });
    await flow.startScan();
    await until(flow, (s) => s.scanTimedOut);
    expect(flow.getState().devices).toEqual([]);
    await flow.dispose();
  });

  it('rejoin mode: an own device that lost WiFi gets new WiFi without a claim', async () => {
    const mine = makeDevice({ id: 'eeeeeeeeeeeeeeeeeeeeeee1', hardwareId: 'xg-3c71bf12ab34', name: 'Tomatoes' });
    const transport = new MockTransport(
      [{ found: SIMULATED_DEVICE, info: { proto: 1, hwId: 'xg-3c71bf12ab34', fw: '2.1.0', claimCode: '', mode: 'rejoin' } }],
      10,
    );
    const { flow, deps } = setup({ transport, myDevices: () => [mine] });
    await flow.chooseDevice(SIMULATED_DEVICE);
    expect(flow.getState()).toMatchObject({ step: 'wifi', device: { name: 'Tomatoes' }, error: null });
    expect(deps.claim).not.toHaveBeenCalled();
    await flow.dispose();
  });

  it('rejoin mode: someone else’s device is refused with a clear message', async () => {
    const transport = new MockTransport(
      [{ found: SIMULATED_DEVICE, info: { proto: 1, hwId: 'xg-00000000ffff', fw: '2.1.0', claimCode: '', mode: 'rejoin' } }],
      10,
    );
    const { flow, deps } = setup({ transport, myDevices: () => [] });
    await flow.chooseDevice(SIMULATED_DEVICE);
    expect(flow.getState().error?.title).toBe('Device belongs to another account');
    expect(deps.claim).not.toHaveBeenCalled();
    await flow.dispose();
  });
});
