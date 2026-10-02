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

const REPLACEMENT = '�';

/**
 * base64 → UTF-8 string. Malformed bytes (truncated sequences, invalid lead bytes, values past
 * U+10FFFF) become U+FFFD instead of throwing, so a bad radio packet can never crash setup — the
 * JSON/Zod validation that follows reports it as a readable error.
 */
export function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  let out = '';
  const cont = (j: number) => j < bin.length && (bin.charCodeAt(j) & 0xc0) === 0x80;
  for (let i = 0; i < bin.length; ) {
    const b0 = bin.charCodeAt(i);
    const len = b0 < 0x80 ? 1 : b0 >= 0xc2 && b0 < 0xe0 ? 2 : b0 >= 0xe0 && b0 < 0xf0 ? 3 : b0 >= 0xf0 && b0 < 0xf5 ? 4 : 0;
    if (len === 0) {
      out += REPLACEMENT;
      i++;
      continue;
    }
    let ok = true;
    for (let k = 1; k < len; k++) if (!cont(i + k)) ok = false;
    if (!ok) {
      out += REPLACEMENT;
      i++;
      continue;
    }
    let cp: number;
    if (len === 1) cp = b0;
    else if (len === 2) cp = ((b0 & 31) << 6) | (bin.charCodeAt(i + 1) & 63);
    else if (len === 3) cp = ((b0 & 15) << 12) | ((bin.charCodeAt(i + 1) & 63) << 6) | (bin.charCodeAt(i + 2) & 63);
    else
      cp =
        ((b0 & 7) << 18) |
        ((bin.charCodeAt(i + 1) & 63) << 12) |
        ((bin.charCodeAt(i + 2) & 63) << 6) |
        (bin.charCodeAt(i + 3) & 63);
    out += cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? REPLACEMENT : String.fromCodePoint(cp);
    i += len;
  }
  return out;
}
