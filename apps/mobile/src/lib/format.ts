import type { PumpReason } from '@xeno/shared';
import type { TemperatureUnit } from './prefs';

export function formatTemp(c: number | null | undefined, unit: TemperatureUnit): { value: string; unit: string } {
  if (c === null || c === undefined) return { value: '—', unit: '' };
  return unit === 'f' ? { value: (c * 1.8 + 32).toFixed(0), unit: '°F' } : { value: c.toFixed(1), unit: '°C' };
}

export const formatPct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)}`);

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "12:05" style countdown from seconds. */
export function countdown(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function durationText(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

const REASONS: Record<PumpReason, string> = {
  dry: 'Watering — soil is dry',
  hold: 'Soil moisture is in the comfort zone',
  wet: 'Soil is moist enough',
  rain: 'Paused — it’s raining',
  cooldown: 'Resting between waterings',
  manual: 'Watering on your command',
  manual_off: 'Automatic watering paused by you',
  idle: 'Manual mode — waiting for your command',
  sensor_fault: 'Sensor problem — watering paused for safety',
  max_runtime: 'Safety stop — pump ran its maximum time',
};

export const pumpReasonText = (r: PumpReason | null | undefined) => (r ? REASONS[r] : 'Waiting for the device…');

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Moisture state for colouring and copy, relative to the device thresholds. */
export function moistureState(v: number | null, low: number, high: number): 'unknown' | 'dry' | 'ok' | 'wet' {
  if (v === null) return 'unknown';
  if (v < low) return 'dry';
  if (v > high + 15) return 'wet';
  return 'ok';
}
