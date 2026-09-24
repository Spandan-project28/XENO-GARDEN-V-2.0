import { base64ToUtf8, utf8ToBase64 } from './codec';

describe('BLE codec', () => {
  it.each(['{"ssid":"Home"}', 'Café Wi-Fi', 'घर का वाईफाई', '🌿 garden 🌧️', ''])('round-trips %p', (s) => {
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s);
  });
  it('produces standard UTF-8 base64', () => {
    expect(utf8ToBase64('é')).toBe('w6k=');
  });
});
