import { describe, expect, it } from 'vitest';
import {
  alertsQuery,
  claimBody,
  defaultSettings,
  deviceSettings,
  loginBody,
  parseTopic,
  readingsQuery,
  registerBody,
  telemetryPayload,
  topicFor,
  wildcardFor,
  desiredState,
  reportedState,
  DEFAULT_SETTINGS,
} from '../src/index.js';

describe('auth schemas', () => {
  it('normalises email', () => {
    const r = registerBody.parse({
      email: '  Me@Example.COM ',
      password: 'longenough',
      name: ' Ann ',
    });
    expect(r.email).toBe('me@example.com');
    expect(r.name).toBe('Ann');
  });
  it('rejects short passwords and bad emails', () => {
    expect(registerBody.safeParse({ email: 'x@y.z', password: 'short', name: 'A' }).success).toBe(
      false,
    );
    expect(loginBody.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });
});

describe('device schemas', () => {
  it('defaults are valid settings', () => {
    expect(deviceSettings.parse(defaultSettings)).toEqual(DEFAULT_SETTINGS);
  });
  it('enforces the hysteresis gap', () => {
    const r = deviceSettings.safeParse({ ...defaultSettings, moistureLow: 40, moistureHigh: 42 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['moistureHigh']);
  });
  it('enforces limits', () => {
    expect(deviceSettings.safeParse({ ...defaultSettings, maxPumpRunSec: 5 }).success).toBe(false);
    expect(deviceSettings.safeParse({ ...defaultSettings, telemetryIntervalSec: 1 }).success).toBe(
      false,
    );
  });
  it('normalises claim input', () => {
    const r = claimBody.parse({ hardwareId: ' XG-3C71BF12AB34 ', claimCode: 'abcd2345' });
    expect(r).toEqual({ hardwareId: 'xg-3c71bf12ab34', claimCode: 'ABCD2345' });
  });
  it('rejects ambiguous claim chars', () => {
    expect(
      claimBody.safeParse({ hardwareId: 'xg-3c71bf12ab34', claimCode: 'ABCD0O11' }).success,
    ).toBe(false);
  });
  it('accepts a full desired + reported shadow', () => {
    expect(
      desiredState.safeParse({
        version: 3,
        mode: 'auto',
        settings: defaultSettings,
        manual: { cmdId: 'abcd', pump: 'ON', durationSec: 600, issuedAt: 1, expiresAt: 600001 },
      }).success,
    ).toBe(true);
    expect(
      reportedState.safeParse({
        appliedVersion: 3,
        mode: 'auto',
        pump: false,
        pumpReason: 'wet',
        manualCmdId: null,
        manualRemainingSec: null,
        cooldownRemainingSec: null,
        fwVersion: '2.0.0',
        rssi: -60,
        ssid: 'Home',
        ip: '10.0.0.5',
        uptimeSec: 100,
        heapFree: 120000,
        soilCalibrated: true,
      }).success,
    ).toBe(true);
  });
});

describe('telemetry schemas', () => {
  const ok = { soilMoisture: 40, soilRaw: 2000, temperature: 20, humidity: 50, rain: false, pump: false };
  it('accepts nulls for faulty sensors', () => {
    expect(
      telemetryPayload.safeParse({
        ...ok,
        soilMoisture: null,
        soilRaw: null,
        temperature: null,
        humidity: null,
      }).success,
    ).toBe(true);
  });
  it('rejects out-of-range values', () => {
    expect(telemetryPayload.safeParse({ ...ok, soilMoisture: 140 }).success).toBe(false);
  });
  it('validates reading ranges', () => {
    expect(
      readingsQuery.safeParse({ from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success,
    ).toBe(false);
    const q = readingsQuery.parse({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' });
    expect(q.resolution).toBe('auto');
  });
});

describe('alerts query', () => {
  it('parses comma-separated statuses', () => {
    expect(alertsQuery.parse({ status: 'open,acknowledged' }).status).toEqual([
      'open',
      'acknowledged',
    ]);
    expect(alertsQuery.safeParse({ status: 'bogus' }).success).toBe(false);
    expect(alertsQuery.parse({}).limit).toBe(30);
  });
});

describe('ota command', () => {
  it('requires https url, sha256 and version', async () => {
    const { commandPayload } = await import('../src/index.js');
    const base = { cmdId: 'abcd1234', type: 'ota', issuedAt: 1 };
    expect(commandPayload.safeParse(base).success).toBe(false);
    expect(
      commandPayload.safeParse({ ...base, url: 'http://x.io/fw.bin', sha256: 'a'.repeat(64), version: '2.1.0' }).success,
    ).toBe(false);
    expect(
      commandPayload.safeParse({ ...base, url: 'https://x.io/fw.bin', sha256: 'a'.repeat(64), version: '2.1.0' }).success,
    ).toBe(true);
    expect(commandPayload.safeParse({ cmdId: 'abcd1234', type: 'identify', issuedAt: 1 }).success).toBe(true);
  });
});

describe('mqtt topics', () => {
  const hw = 'xg-3c71bf12ab34';
  it('builds and parses topics round-trip', () => {
    const t = topicFor(hw, 'cmdAck');
    expect(t).toBe(`xg/v1/${hw}/cmd/ack`);
    expect(parseTopic(t)).toEqual({ hardwareId: hw, kind: 'cmdAck' });
    expect(parseTopic(`xg/v1/${hw}/telemetry`)?.kind).toBe('telemetry');
  });
  it('rejects foreign topics', () => {
    expect(parseTopic('other/v1/a/telemetry')).toBeNull();
    expect(parseTopic('xg/v1/a/unknown')).toBeNull();
    expect(parseTopic('xg/v1//telemetry')).toBeNull();
  });
  it('builds wildcards', () => {
    expect(wildcardFor('telemetry')).toBe('xg/v1/+/telemetry');
  });
});
