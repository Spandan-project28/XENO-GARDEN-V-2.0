import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, topicFor, type DesiredState } from '@xeno/shared';
import { SimDevice, type SimTransport } from '../src/device.js';
import { createRng } from '../src/physics.js';
import { scenarios, type Scenario } from '../src/scenarios.js';
import { simIdentity } from '../src/provision.js';

const HW = 'xg-aabbccddeeff';

class FakeTransport implements SimTransport {
  connected = false;
  sent: { topic: string; payload: string; retain: boolean }[] = [];
  subs: string[] = [];
  private onMsg: (t: string, p: string) => void = () => {};
  private onConn: (c: boolean) => void = () => {};
  async connect() {
    this.connected = true;
    this.onConn(true);
  }
  publish(topic: string, payload: string, opts: { retain?: boolean }) {
    this.sent.push({ topic, payload, retain: !!opts.retain });
  }
  onMessage(h: (t: string, p: string) => void) {
    this.onMsg = h;
  }
  onConnectionChange(h: (c: boolean) => void) {
    this.onConn = h;
  }
  async subscribe(topics: string[]) {
    this.subs.push(...topics);
  }
  isConnected() {
    return this.connected;
  }
  drop() {
    this.connected = false;
    this.onConn(false);
  }
  reconnect() {
    this.connected = true;
    this.onConn(true);
  }
  async end() {
    this.connected = false;
  }
  deliver(kind: 'desired' | 'cmd', payload: object) {
    this.onMsg(topicFor(HW, kind), JSON.stringify(payload));
  }
  of(kind: 'telemetry' | 'reported' | 'status' | 'event' | 'cmdAck') {
    return this.sent.filter((s) => s.topic === topicFor(HW, kind)).map((s) => (kind === 'status' ? s.payload : JSON.parse(s.payload)));
  }
}

let mono = 0;
let epoch = Date.parse('2026-05-01T10:00:00Z');
const clock = { mono: () => mono, epoch: () => epoch };
const advance = (ms: number) => {
  mono += ms;
  epoch += ms;
};

function make(scenario: Scenario = scenarios.steady) {
  const transport = new FakeTransport();
  const device = new SimDevice({ hardwareId: HW, transport, scenario, clock, rng: createRng(1) });
  return { device, transport };
}

const desired = (over: Partial<DesiredState> = {}): DesiredState => ({
  version: 1,
  mode: 'auto',
  settings: { ...defaultSettings },
  manual: null,
  ...over,
});

beforeEach(() => {
  mono = 0;
  epoch = Date.parse('2026-05-01T10:00:00Z');
});

describe('SimDevice', () => {
  it('announces itself on connect like the firmware', async () => {
    const { device, transport } = make();
    await device.start();
    expect(transport.of('status')).toEqual(['online']);
    expect(transport.subs).toEqual([topicFor(HW, 'desired'), topicFor(HW, 'cmd')]);
    expect(transport.of('event')[0]).toMatchObject({ type: 'boot' });
    expect(transport.of('reported')[0]).toMatchObject({ appliedVersion: 0, fwVersion: '2.0.0-sim' });
  });

  it('waters dry soil automatically and reports it immediately', async () => {
    const { device, transport } = make({ ...scenarios.steady, initial: { ...scenarios.steady.initial, soil: 10 } });
    await device.start();
    transport.deliver('desired', desired());
    const tele = transport.of('telemetry');
    expect(tele.at(-1)).toMatchObject({ pump: true });
    expect(transport.of('reported').at(-1)).toMatchObject({ appliedVersion: 1, pump: true, pumpReason: 'dry' });
  });

  it('follows manual commands until they expire, then hands back to auto', async () => {
    const { device, transport } = make();
    await device.start();
    transport.deliver(
      'desired',
      desired({ version: 2, manual: { cmdId: 'cmd1', pump: 'ON', durationSec: 60, issuedAt: epoch, expiresAt: epoch + 60_000 } }),
    );
    expect(device.pumpOn).toBe(true);
    expect(transport.of('reported').at(-1)).toMatchObject({ manualCmdId: 'cmd1', pumpReason: 'manual', manualRemainingSec: 60 });
    advance(59_000);
    device.tick();
    expect(device.pumpOn).toBe(true);
    advance(2_000);
    device.tick();
    expect(device.pumpOn).toBe(false);
    expect(transport.of('reported').at(-1)).toMatchObject({ manualCmdId: null });
  });

  it('ignores stale desired versions and already-expired commands', async () => {
    const { device, transport } = make();
    await device.start();
    transport.deliver('desired', desired({ version: 5, mode: 'manual' }));
    transport.deliver('desired', desired({ version: 4, mode: 'auto' }));
    expect(device.mode).toBe('manual');
    transport.deliver(
      'desired',
      desired({ version: 6, mode: 'manual', manual: { cmdId: 'old1', pump: 'ON', durationSec: 60, issuedAt: epoch - 120_000, expiresAt: epoch - 60_000 } }),
    );
    expect(device.pumpOn).toBe(false);
    expect(device.appliedVersion).toBe(6);
  });

  it('enforces max runtime and emits an event', async () => {
    const { device, transport } = make({ ...scenarios.steady, initial: { ...scenarios.steady.initial, soil: 5 }, physics: { dryRate: 0, pumpRate: 0, rainRate: 0 } });
    await device.start();
    transport.deliver('desired', desired({ settings: { ...defaultSettings, maxPumpRunSec: 60 } }));
    expect(device.pumpOn).toBe(true);
    for (let i = 0; i < 61; i++) {
      advance(1000);
      device.tick();
    }
    expect(device.pumpOn).toBe(false);
    expect(device.pumpReason).toBe('cooldown');
    expect(transport.of('event').some((e) => e.type === 'max_runtime')).toBe(true);
  });

  it('keeps running offline, buffers telemetry and flushes on reconnect', async () => {
    const { device, transport } = make();
    await device.start();
    transport.deliver('desired', desired({ settings: { ...defaultSettings, telemetryIntervalSec: 5 } }));
    transport.drop();
    const before = transport.of('telemetry').length;
    for (let i = 0; i < 30; i++) {
      advance(1000);
      device.tick();
    }
    expect(transport.of('telemetry').length).toBe(before);
    transport.reconnect();
    expect(transport.of('telemetry').length).toBe(before + 6);
  });

  it('acks commands', async () => {
    const { device, transport } = make();
    await device.start();
    transport.deliver('cmd', { cmdId: 'k111', type: 'identify', issuedAt: epoch });
    expect(transport.of('cmdAck')).toEqual([{ cmdId: 'k111', ok: true }]);
    expect(device.acks).toEqual(['identify']);
  });

  it('sensor_fault scenario reports null soil and raises events', async () => {
    const { device, transport } = make(scenarios.sensor_fault);
    await device.start();
    transport.deliver('desired', desired());
    for (let i = 0; i < 35; i++) {
      advance(1000);
      device.tick();
    }
    expect(transport.of('telemetry').at(-1)).toMatchObject({ soilMoisture: null, soilRaw: null });
    expect(transport.of('event').some((e) => e.type === 'sensor_fault')).toBe(true);
    expect(device.pumpOn).toBe(false);
  });

  it('rain scenario blocks watering via rain lockout', async () => {
    const { device, transport } = make(scenarios.rain);
    await device.start();
    transport.deliver('desired', desired());
    expect(device.pumpOn).toBe(true); // dry at start
    for (let i = 0; i < 25; i++) {
      advance(1000);
      device.tick();
    }
    expect(device.pumpOn).toBe(false);
    expect(device.pumpReason).toBe('rain');
  });
});

describe('simIdentity', () => {
  it('is deterministic and valid', () => {
    const a = simIdentity('seed', 0);
    expect(a).toEqual(simIdentity('seed', 0));
    expect(a.hardwareId).toMatch(/^xg-[0-9a-f]{12}$/);
    expect(a.claimCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(simIdentity('seed', 1).hardwareId).not.toBe(a.hardwareId);
  });
});
