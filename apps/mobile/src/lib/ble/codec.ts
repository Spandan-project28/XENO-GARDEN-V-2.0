import { decode as atob, encode as btoa } from 'base-64';

/** UTF-8 string → base64 (the encoding react-native-ble-plx uses for characteristic values). */
export function utf8ToBase64(s: string): string {
  let bin = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) bin += String.fromCharCode(c);
    else if (c < 0x800) bin += String.fromCharCode(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bin += String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      bin += String.fromCharCode(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return btoa(bin);
}

/** base64 → UTF-8 string. */
export function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  let out = '';
  for (let i = 0; i < bin.length; ) {
    const b0 = bin.charCodeAt(i++);
    if (b0 < 0x80) out += String.fromCharCode(b0);
    else if (b0 < 0xe0) out += String.fromCharCode(((b0 & 31) << 6) | (bin.charCodeAt(i++) & 63));
    else if (b0 < 0xf0)
      out += String.fromCharCode(((b0 & 15) << 12) | ((bin.charCodeAt(i++) & 63) << 6) | (bin.charCodeAt(i++) & 63));
    else {
      const cp =
        ((b0 & 7) << 18) |
        ((bin.charCodeAt(i++) & 63) << 12) |
        ((bin.charCodeAt(i++) & 63) << 6) |
        (bin.charCodeAt(i++) & 63);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}
