/**
 * BLE provisioning protocol (app ⇄ ESP32). Characteristic UUIDs live in constants (BLE).
 * Mirrored by firmware/src/provisioning — keep both in sync.
 *
 * All payloads are UTF-8 JSON. Writes larger than one BLE packet are split into frames:
 *     "<index>/<total>:<chunk>"      e.g. "0/2:{\"ssid\":\"Ho" , "1/2:me\",\"pw\":\"…\"}"
 * The device reassembles frames per characteristic and parses JSON when index = total-1.
 * Notifications from the device are always single-frame JSON (they're small).
 */
import { z } from 'zod';
import { PROVISIONING_STATES, WIFI_FAILURE_REASONS } from '../constants/index.js';

export const BLE_PROTOCOL_VERSION = 1;
/** Conservative chunk size that fits a 185-byte MTU (iOS default) with ATT + frame header. */
export const BLE_CHUNK_BYTES = 160;

/** `info` characteristic (read). */
export const bleInfoPayload = z.object({
  proto: z.number().int(),
  hwId: z.string(),
  fw: z.string(),
  claimCode: z.string(),
});
export type BleInfoPayload = z.infer<typeof bleInfoPayload>;

/** `wifi_scan` notifications: one per network, then an end marker. */
export const wifiScanFrame = z.discriminatedUnion('t', [
  z.object({ t: z.literal('net'), ssid: z.string().max(32), rssi: z.number().int(), sec: z.boolean() }),
  z.object({ t: z.literal('end'), n: z.number().int().nonnegative() }),
]);
export type WifiScanFrame = z.infer<typeof wifiScanFrame>;

export interface WifiNetwork {
  ssid: string;
  rssi: number;
  secure: boolean;
}

/** `wifi_creds` write. */
export const wifiCredsPayload = z.object({
  ssid: z.string().min(1).max(32),
  pw: z.string().max(64),
});
export type WifiCredsPayload = z.infer<typeof wifiCredsPayload>;

/** `cloud_creds` write (from the claim response). */
export const cloudCredsPayload = z.object({
  h: z.string().min(1).max(253),
  p: z.number().int().min(1).max(65535),
  t: z.boolean(),
  u: z.string().min(1).max(64),
  pw: z.string().min(1).max(128),
});
export type CloudCredsPayload = z.infer<typeof cloudCredsPayload>;

/** `state` notifications. */
export const provisioningStatePayload = z.object({
  s: z.enum(PROVISIONING_STATES),
  r: z.enum(WIFI_FAILURE_REASONS).optional(),
  ip: z.string().optional(),
});
export type ProvisioningStatePayload = z.infer<typeof provisioningStatePayload>;

/** UTF-8 byte length of a string. */
export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Splits a JSON message into frames, never cutting a multi-byte character. */
export function toFrames(message: string, chunkBytes = BLE_CHUNK_BYTES): string[] {
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of message) {
    const b = utf8Length(ch);
    if (curBytes + b > chunkBytes && cur) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  if (cur || !parts.length) parts.push(cur);
  return parts.map((p, i) => `${i}/${parts.length}:${p}`);
}

/** Reassembles frames (in order). Returns the message once complete, else null. */
export class FrameAssembler {
  private parts: string[] = [];
  private total = 0;

  push(frame: string): string | null {
    const m = /^(\d+)\/(\d+):([\s\S]*)$/.exec(frame);
    if (!m) throw new Error('Malformed frame');
    const index = Number(m[1]);
    const total = Number(m[2]);
    if (index === 0) {
      this.parts = [];
      this.total = total;
    }
    if (total !== this.total || index !== this.parts.length) {
      this.parts = [];
      throw new Error('Out-of-order frame');
    }
    this.parts.push(m[3]!);
    if (this.parts.length === total) {
      const msg = this.parts.join('');
      this.parts = [];
      return msg;
    }
    return null;
  }
}
