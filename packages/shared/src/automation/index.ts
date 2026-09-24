/**
 * Reference implementation of the on-device irrigation rules.
 *
 * The ESP32 firmware (`firmware/src/automation/`) is a line-for-line C++ port and both must pass
 * `test-vectors/automation.json`. The simulator uses this implementation directly.
 *
 * Pure function: no clocks, no I/O. All times are milliseconds on one monotonic clock chosen by
 * the caller (device millis() or epoch ms — it only has to be consistent within a call).
 */
import type { DeviceMode, PumpAction, PumpReason } from '../constants/index.js';

export interface AutomationSettings {
  moistureLow: number;
  moistureHigh: number;
  maxPumpRunSec: number;
  cooldownSec: number;
  rainLockout: boolean;
}

export interface ActiveManual {
  cmdId: string;
  pump: PumpAction;
  /** Same clock as `now`. */
  expiresAt: number;
}

export interface AutomationInput {
  now: number;
  mode: DeviceMode;
  settings: AutomationSettings;
  /** Calibrated soil moisture %, or null when the sensor is faulty/unreadable. */
  soilMoisture: number | null;
  rain: boolean;
  pumpOn: boolean;
  /** When the pump last changed to its current state (same clock as now). */
  pumpSince: number;
  /** Cooldown end, or null when not cooling down. */
  cooldownUntil: number | null;
  manual: ActiveManual | null;
}

export interface AutomationOutput {
  pumpOn: boolean;
  reason: PumpReason;
  pumpSince: number;
  cooldownUntil: number | null;
  /** The manual command still in effect after this tick (expired/cancelled ones become null). */
  manual: ActiveManual | null;
}

type Decision = Pick<AutomationOutput, 'pumpOn' | 'reason'>;

export function evaluateAutomation(input: AutomationInput): AutomationOutput {
  const { now, settings: s } = input;

  let manual = input.manual && now < input.manual.expiresAt ? input.manual : null;
  let cooldownUntil =
    input.cooldownUntil !== null && now < input.cooldownUntil ? input.cooldownUntil : null;

  const finish = (d: Decision): AutomationOutput => ({
    pumpOn: d.pumpOn,
    reason: d.reason,
    pumpSince: d.pumpOn === input.pumpOn ? input.pumpSince : now,
    cooldownUntil,
    manual,
  });

  // 1. Hard safety: nothing may run the pump longer than maxPumpRunSec.
  if (input.pumpOn && now - input.pumpSince >= s.maxPumpRunSec * 1000) {
    cooldownUntil = now + s.cooldownSec * 1000;
    manual = null;
    return finish({ pumpOn: false, reason: 'max_runtime' });
  }

  // 2. An unexpired manual command wins over the mode (ON is refused while cooling down).
  if (manual) {
    if (manual.pump === 'OFF') return finish({ pumpOn: false, reason: 'manual_off' });
    if (cooldownUntil !== null) {
      manual = null;
      return finish({ pumpOn: false, reason: 'cooldown' });
    }
    return finish({ pumpOn: true, reason: 'manual' });
  }

  // 3. Manual mode without a command: the pump rests.
  if (input.mode === 'manual') return finish({ pumpOn: false, reason: 'idle' });

  // 4–6. Auto-mode interlocks.
  if (input.soilMoisture === null || !Number.isFinite(input.soilMoisture)) {
    return finish({ pumpOn: false, reason: 'sensor_fault' });
  }
  if (s.rainLockout && input.rain) return finish({ pumpOn: false, reason: 'rain' });
  if (cooldownUntil !== null) return finish({ pumpOn: false, reason: 'cooldown' });

  // 7. Hysteresis thresholds.
  if (input.soilMoisture < s.moistureLow) return finish({ pumpOn: true, reason: 'dry' });
  if (input.soilMoisture > s.moistureHigh) return finish({ pumpOn: false, reason: 'wet' });
  return finish({ pumpOn: input.pumpOn, reason: 'hold' });
}

/**
 * Converts a raw ADC reading into moisture % given two calibration points.
 * Works whichever way the sensor is wired (capacitive sensors read higher when dry).
 * Returns null when the calibration is unusable or the raw value looks like a disconnected or
 * shorted sensor (pinned at either ADC rail).
 */
export const SOIL_RAW_FAULT_LOW = 50;
export const SOIL_RAW_FAULT_HIGH = 4050;

export function rawToMoisture(raw: number, dryRaw: number, wetRaw: number): number | null {
  if (!Number.isFinite(raw) || raw < SOIL_RAW_FAULT_LOW || raw > SOIL_RAW_FAULT_HIGH) return null;
  const span = wetRaw - dryRaw;
  if (Math.abs(span) < 100) return null;
  const pct = ((raw - dryRaw) / span) * 100;
  const clamped = Math.min(100, Math.max(0, pct));
  return Math.round(clamped * 10) / 10;
}
