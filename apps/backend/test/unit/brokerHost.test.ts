import { describe, expect, it } from 'vitest';
import { brokerHost } from '../../src/modules/devices/service.js';

describe('brokerHost', () => {
  it('uses the configured host unless it is auto', () => {
    expect(brokerHost('xeno.fly.dev', '10.0.0.5')).toBe('xeno.fly.dev');
  });
  it('auto: follows the address the client used', () => {
    expect(brokerHost('auto', '192.168.0.108')).toBe('192.168.0.108');
    expect(brokerHost('auto', '[fe80::1]')).toBe('fe80::1');
    expect(brokerHost('auto', 'my-pc.local')).toBe('my-pc.local');
  });
  it('auto: never hands a device a loopback address it could not reach anyway', () => {
    expect(brokerHost('auto', '127.0.0.1')).toBe('localhost');
    expect(brokerHost('auto', undefined)).toBe('localhost');
  });
});
