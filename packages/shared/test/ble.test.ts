import { describe, expect, it } from 'vitest';
import {
  cloudCredsPayload,
  FrameAssembler,
  provisioningStatePayload,
  toFrames,
  utf8Length,
  wifiScanFrame,
} from '../src/ble/index.js';

describe('BLE framing', () => {
  it('keeps short messages in one frame', () => {
    expect(toFrames('{"a":1}')).toEqual(['0/1:{"a":1}']);
  });

  it('splits long messages within the byte budget and reassembles them', () => {
    const msg = JSON.stringify({ h: 'mqtt.' + 'x'.repeat(200) + '.example.com', p: 8883, t: true, u: 'xg-aabbccddeeff', pw: 'p'.repeat(40) });
    const frames = toFrames(msg, 100);
    expect(frames.length).toBeGreaterThan(2);
    for (const f of frames) expect(utf8Length(f.slice(f.indexOf(':') + 1))).toBeLessThanOrEqual(100);
    const asm = new FrameAssembler();
    let out: string | null = null;
    for (const f of frames) out = asm.push(f);
    expect(out).toBe(msg);
    expect(cloudCredsPayload.parse(JSON.parse(out!)).p).toBe(8883);
  });

  it('never splits multi-byte characters (emoji / non-latin SSIDs)', () => {
    const msg = JSON.stringify({ ssid: 'Café 🌿 घर', pw: 'ñ'.repeat(50) });
    const frames = toFrames(msg, 7);
    const asm = new FrameAssembler();
    let out: string | null = null;
    for (const f of frames) out = asm.push(f);
    expect(out).toBe(msg);
  });

  it('rejects out-of-order and malformed frames, recovers on a new message', () => {
    const asm = new FrameAssembler();
    const frames = toFrames('abcdefghij', 3);
    asm.push(frames[0]!);
    expect(() => asm.push(frames[2]!)).toThrow(/Out-of-order/);
    expect(() => asm.push('garbage')).toThrow(/Malformed/);
    let out: string | null = null;
    for (const f of frames) out = asm.push(f);
    expect(out).toBe('abcdefghij');
  });

  it('validates notification payloads', () => {
    expect(wifiScanFrame.parse({ t: 'net', ssid: 'Home', rssi: -50, sec: true }).t).toBe('net');
    expect(wifiScanFrame.parse({ t: 'end', n: 3 }).t).toBe('end');
    expect(provisioningStatePayload.safeParse({ s: 'wifi_failed', r: 'wrong_password' }).success).toBe(true);
    expect(provisioningStatePayload.safeParse({ s: 'bogus' }).success).toBe(false);
  });
});
