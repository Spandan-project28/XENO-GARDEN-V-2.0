import type { ProvisioningStatePayload } from '@xeno/shared';
import { MockTransport, SIMULATED_DEVICES } from './mock';

const creds = { h: 'broker.local', p: 1883, t: false, u: 'xg-de0000000001', pw: 'p'.repeat(32) };

async function join(bridge: Parameters<typeof makeTransport>[0]) {
  const transport = makeTransport(bridge);
  const s = await transport.connect('sim-1');
  await s.writeCloudCreds(creds);
  const states: ProvisioningStatePayload['s'][] = [];
  const done = new Promise<void>((resolve) =>
    s.onState((st) => {
      states.push(st.s);
      if (st.s === 'online' || st.s === 'cloud_failed' || st.s === 'wifi_failed') resolve();
    }),
  );
  await s.writeWifiCreds('Home WiFi', 'garden-pass');
  await done;
  return states;
}

const makeTransport = (bridge: ConstructorParameters<typeof MockTransport>[3]) =>
  new MockTransport(SIMULATED_DEVICES, 1, () => false, bridge);

describe('simulated device + dev virtual radio', () => {
  it('hands the claimed credentials to the simulator before saying online', async () => {
    const bridge = jest.fn(async () => undefined);
    expect(await join(bridge)).toEqual(['connecting_wifi', 'connecting_cloud', 'online']);
    expect(bridge).toHaveBeenCalledWith({ hwId: 'xg-de0000000001', cloud: creds, ssid: 'Home WiFi' });
  });

  it('reports cloud_failed when the simulator is not reachable', async () => {
    expect(await join(async () => Promise.reject(new Error('offline')))).toContain('cloud_failed');
  });

  it('works on its own without a bridge (tests, demos without the simulator)', async () => {
    expect(await join(null)).toContain('online');
  });

  it('hides devices that are already set up', () => {
    jest.useFakeTimers();
    const found: string[] = [];
    const t = new MockTransport(SIMULATED_DEVICES, 1, (hw) => hw === 'xg-de0000000001');
    const stop = t.scan((d) => found.push(d.name));
    jest.advanceTimersByTime(10);
    stop();
    jest.useRealTimers();
    expect(found).toEqual(['Xeno-DEM2']);
  });
});
