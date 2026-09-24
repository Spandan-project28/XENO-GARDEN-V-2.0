import { QueryClient } from '@tanstack/react-query';
import { defaultSettings, type DevicePublic } from '@xeno/shared';
import { applyShadow, applyStatus, applyTelemetry, patchDevice, removeDevice } from './deviceCache';
import { useLiveTelemetry } from './liveTelemetry';
import { qk } from './queryKeys';
import { RealtimeManager, type SocketFactory } from './realtime';
import { useSession } from './session';

const device = (over: Partial<DevicePublic> = {}): DevicePublic => ({
  id: 'd1',
  hardwareId: 'xg-aabbccddeeff',
  name: 'Balcony',
  plantId: null,
  online: false,
  lastSeenAt: null,
  claimedAt: '2026-01-01T00:00:00.000Z',
  firmwareVersion: null,
  desired: { version: 2, mode: 'auto', settings: { ...defaultSettings }, manual: null },
  reported: null,
  latest: null,
  syncPending: true,
  ...over,
});

class FakeSocket {
  connected = false;
  handlers = new Map<string, (...a: unknown[]) => void>();
  emitted: { event: string; payload: unknown }[] = [];
  on(event: string, h: (...a: unknown[]) => void) {
    this.handlers.set(event, h);
    return this;
  }
  emit(event: string, payload: unknown, ack?: (r: unknown) => void) {
    this.emitted.push({ event, payload });
    ack?.({ ok: true, device: device({ online: true }) });
    return this;
  }
  fire(event: string, ...args: unknown[]) {
    if (event === 'connect') this.connected = true;
    this.handlers.get(event)?.(...args);
  }
  removeAllListeners() {
    this.handlers.clear();
  }
  disconnect() {
    this.connected = false;
  }
  connect() {}
}

describe('device cache patchers', () => {
  it('telemetry updates list + detail and marks online', () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.devices, [device()]);
    qc.setQueryData(qk.device('d1'), device());
    patchDevice(
      qc,
      'd1',
      applyTelemetry({ deviceId: 'd1', at: '2026-01-01T10:00:00Z', soilMoisture: 33, soilRaw: 2000, temperature: 21, humidity: 50, rain: false, pump: true }),
    );
    for (const d of [qc.getQueryData<DevicePublic[]>(qk.devices)![0]!, qc.getQueryData<DevicePublic>(qk.device('d1'))!]) {
      expect(d.online).toBe(true);
      expect(d.latest).toMatchObject({ soilMoisture: 33, pump: true });
    }
  });

  it('shadow recomputes syncPending', () => {
    const d = device();
    const reported = {
      appliedVersion: 2, mode: 'auto' as const, pump: false, pumpReason: 'wet' as const, manualCmdId: null,
      manualRemainingSec: null, cooldownRemainingSec: null, fwVersion: '2.1.0', rssi: -50, ssid: 'x', ip: null,
      uptimeSec: 1, heapFree: 1, soilCalibrated: true, at: '2026-01-01T00:00:00Z',
    };
    const next = applyShadow({ deviceId: 'd1', reported })(d);
    expect(next.syncPending).toBe(false);
    expect(next.firmwareVersion).toBe('2.1.0');
    const bumped = applyShadow({ deviceId: 'd1', desired: { ...d.desired, version: 3 } })(next);
    expect(bumped.syncPending).toBe(true);
  });

  it('status and removal', () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.devices, [device({ online: true })]);
    patchDevice(qc, 'd1', applyStatus({ deviceId: 'd1', online: false, at: '2026-01-01T00:00:00Z' }));
    expect(qc.getQueryData<DevicePublic[]>(qk.devices)![0]!.online).toBe(false);
    removeDevice(qc, 'd1');
    expect(qc.getQueryData<DevicePublic[]>(qk.devices)).toEqual([]);
  });
});

describe('RealtimeManager', () => {
  beforeEach(() => useSession.setState({ status: 'signedIn', accessToken: 'tok', user: null }));

  it('ref-counts subscriptions and resubscribes after reconnect', async () => {
    const sock = new FakeSocket();
    let authPayload: object | null = null;
    const factory: SocketFactory = (_url, auth) => {
      auth((p) => (authPayload = p));
      return sock as never;
    };
    const rt = new RealtimeManager(factory, () => 'https://api.test');
    const qc = new QueryClient();
    await rt.start(qc);
    expect(authPayload).toEqual({ token: 'tok' });

    rt.subscribe('d1');
    rt.subscribe('d1');
    expect(sock.emitted).toHaveLength(0); // not connected yet
    sock.fire('connect');
    expect(sock.emitted.filter((e) => e.event === 'subscribe')).toHaveLength(1);
    expect(qc.getQueryData<DevicePublic>(qk.device('d1'))?.online).toBe(true); // ack snapshot cached

    rt.unsubscribe('d1');
    expect(sock.emitted.some((e) => e.event === 'unsubscribe')).toBe(false);
    rt.unsubscribe('d1');
    expect(sock.emitted.filter((e) => e.event === 'unsubscribe')).toHaveLength(1);
    expect(rt.subscribedIds).toEqual([]);

    rt.subscribe('d2');
    sock.fire('disconnect');
    sock.fire('connect');
    expect(sock.emitted.filter((e) => e.event === 'subscribe' && (e.payload as { deviceId: string }).deviceId === 'd2')).toHaveLength(2);
    rt.stop();
  });

  it('feeds live telemetry into the buffer and cache', async () => {
    const sock = new FakeSocket();
    const rt = new RealtimeManager(() => sock as never, () => 'https://api.test');
    const qc = new QueryClient();
    qc.setQueryData(qk.devices, [device()]);
    await rt.start(qc);
    sock.fire('connect');
    sock.fire('telemetry', { deviceId: 'd1', at: '2026-01-01T10:00:00Z', soilMoisture: 40, soilRaw: 1, temperature: 20, humidity: 50, rain: false, pump: false });
    expect(useLiveTelemetry.getState().byDevice.d1).toHaveLength(1);
    expect(qc.getQueryData<DevicePublic[]>(qk.devices)![0]!.latest?.soilMoisture).toBe(40);
    rt.stop();
  });
});
