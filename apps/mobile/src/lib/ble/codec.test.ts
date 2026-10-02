import { base64ToUtf8, utf8ToBase64 } from './codec';
import { checkInfo } from './plx';

describe('BLE codec', () => {
  it.each(['{"ssid":"Home"}', 'Café Wi-Fi', 'घर का वाईफाई', '🌿 garden 🌧️', ''])('round-trips %p', (s) => {
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s);
  });
  it('produces standard UTF-8 base64', () => {
    expect(utf8ToBase64('é')).toBe('w6k=');
  });
  it('never throws on garbage bytes from the radio (replaces them with U+FFFD)', () => {
    // {"claimCode":"<0xFF 0xFE 0xF8 0x80 0xC0>"} — what a corrupted firmware reply looks like.
    const bytes = [...Buffer.from('{"claimCode":"', 'latin1'), 0xff, 0xfe, 0xf8, 0x80, 0xc0, ...Buffer.from('"}', 'latin1')];
    const b64 = Buffer.from(bytes).toString('base64');
    expect(() => base64ToUtf8(b64)).not.toThrow();
    const s = base64ToUtf8(b64);
    expect(s.startsWith('{"claimCode":"')).toBe(true);
    expect(s).toContain('�');
    // Truncated multi-byte sequence at the end, and a code point past U+10FFFF.
    expect(base64ToUtf8(Buffer.from([0x41, 0xe2, 0x82]).toString('base64'))).toBe('A��');
    expect(base64ToUtf8(Buffer.from([0xf4, 0x90, 0x80, 0x80]).toString('base64'))).toBe('�');
  });

  it('a setup-mode device with a broken claim code asks for a firmware re-flash', () => {
    const base = { proto: 1, hwId: 'xg-aabbccddeeff', fw: '2.1.0' };
    expect(() => checkInfo({ ...base, mode: 'setup', claimCode: '��AB12' })).toThrow(/Re-flash/);
    expect(() => checkInfo({ ...base, mode: 'setup', claimCode: 'DEMO2345' })).toThrow(/Re-flash/);
    expect(checkInfo({ ...base, mode: 'setup', claimCode: 'ABCD2345' }).claimCode).toBe('ABCD2345');
    expect(checkInfo({ ...base, mode: 'rejoin', claimCode: '' }).mode).toBe('rejoin');
  });
});
