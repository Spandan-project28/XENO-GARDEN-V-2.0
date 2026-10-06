/**
 * Constants that cross a boundary (backend ⇄ app ⇄ device).
 * The firmware mirrors the ones it needs in `firmware/include/contract.h` — keep them in sync.
 */

export const API_VERSION = 'v1' as const;
export const MQTT_ROOT = 'xg/v1' as const;

/** Hardware IDs are derived from the ESP32 MAC: "xg-" + 12 lowercase hex chars. */
export const HARDWARE_ID_PATTERN = /^xg-[0-9a-f]{12}$/;
/** Claim codes are 8 chars from an unambiguous alphabet (no 0/O/1/I/L). */
export const CLAIM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CLAIM_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export const BLE = {
  /** Advertised name: prefix + last 4 hex digits of the MAC, e.g. "Xeno-AB12". */
  deviceNamePrefix: 'Xeno-',
  serviceUuid: '6b1f0001-5e6a-4c2b-9d3e-8a7c1b2f4e10',
  characteristics: {
    info: '6b1f0002-5e6a-4c2b-9d3e-8a7c1b2f4e10',
    wifiScan: '6b1f0003-5e6a-4c2b-9d3e-8a7c1b2f4e10',
    wifiCreds: '6b1f0004-5e6a-4c2b-9d3e-8a7c1b2f4e10',
    cloudCreds: '6b1f0005-5e6a-4c2b-9d3e-8a7c1b2f4e10',
    state: '6b1f0006-5e6a-4c2b-9d3e-8a7c1b2f4e10',
  },
  /** How long pairing mode stays open after being triggered. */
  pairingWindowSec: 120,
} as const;

export const PROVISIONING_STATES = [
  'idle',
  'scanning',
  'connecting_wifi',
  'wifi_failed',
  'connecting_cloud',
  'cloud_failed',
  'online',
] as const;
export type ProvisioningState = (typeof PROVISIONING_STATES)[number];

export const WIFI_FAILURE_REASONS = [
  'wrong_password',
  'ssid_not_found',
  'no_internet',
  'timeout',
  'unknown',
] as const;
export type WifiFailureReason = (typeof WIFI_FAILURE_REASONS)[number];

export const DEVICE_MODES = ['auto', 'manual'] as const;
export type DeviceMode = (typeof DEVICE_MODES)[number];

export const PUMP_ACTIONS = ['ON', 'OFF'] as const;
export type PumpAction = (typeof PUMP_ACTIONS)[number];

/** Why the pump is in its current state. Produced by the automation engine on the device. */
export const PUMP_REASONS = [
  'max_runtime',
  'manual',
  'manual_off',
  'idle',
  'sensor_fault',
  'rain',
  'cooldown',
  'dry',
  'wet',
  'hold',
] as const;
export type PumpReason = (typeof PUMP_REASONS)[number];

export const ALERT_TYPES = [
  'LOW_MOISTURE',
  'SENSOR_FAULT',
  'DEVICE_OFFLINE',
  'PUMP_MAX_RUNTIME',
  'HIGH_TEMP',
  'PLANT_HEALTH',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const DEVICE_COMMAND_TYPES = [
  'identify',
  'reboot',
  'pairing',
  'calibrate_dry',
  'calibrate_wet',
  'factory_reset',
  'ota',
] as const;
export type DeviceCommandType = (typeof DEVICE_COMMAND_TYPES)[number];

export const DEVICE_EVENT_TYPES = [
  'boot',
  'sensor_fault',
  'sensor_recovered',
  'max_runtime',
  'wifi_changed',
  'calibrated',
] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];

export const HEALTH_STATUSES = ['healthy', 'attention', 'critical', 'unknown'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const READING_RESOLUTIONS = ['auto', 'raw', '5m', '1h', '1d'] as const;
export type ReadingResolution = (typeof READING_RESOLUTIONS)[number];

/** Limits for device settings — shared by UI sliders, backend validation and firmware clamping. */
export const SETTINGS_LIMITS = {
  moisture: { min: 0, max: 100 },
  /** Minimum gap between low and high thresholds (hysteresis band). */
  moistureMinGap: 5,
  maxPumpRunSec: { min: 30, max: 3600 },
  cooldownSec: { min: 30, max: 7200 },
  telemetryIntervalSec: { min: 2, max: 300 },
  highTempC: { min: 20, max: 60 },
  manualDurationSec: { min: 10, max: 3600 },
} as const;

export const DEFAULT_SETTINGS = {
  moistureLow: 30,
  moistureHigh: 45,
  maxPumpRunSec: 600,
  cooldownSec: 300,
  rainLockout: true,
  highTempC: 38,
  telemetryIntervalSec: 5,
} as const;

/** Realtime (Socket.IO) contract. */
export const SOCKET = {
  namespace: '/rt',
  clientEvents: {
    subscribe: 'subscribe',
    unsubscribe: 'unsubscribe',
  },
  serverEvents: {
    telemetry: 'telemetry',
    shadow: 'shadow',
    status: 'status',
    alert: 'alert',
    event: 'device_event',
    cmdAck: 'cmd_ack',
    deviceRemoved: 'device_removed',
  },
} as const;

export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'DEVICE_ALREADY_CLAIMED',
  'INVALID_CLAIM_CODE',
  'DEVICE_OFFLINE',
  'INTERNAL',
  /** Plant scan: no disease model connected (503) / the model failed to answer (502). */
  'SCAN_UNAVAILABLE',
  'SCAN_FAILED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Friendly default names for devices: "Xeno 1", "Xeno 2", … */
export const DEVICE_NAME_BASE = 'Xeno';
export const defaultDeviceName = (n: number) => `${DEVICE_NAME_BASE} ${n}`;

/** The lowest "Xeno N" not already used by one of the owner's devices. */
export function nextDefaultDeviceName(existing: readonly string[]): string {
  const used = new Set<number>();
  const re = /^xeno (\d+)$/i;
  for (const name of existing) {
    const m = re.exec(name.trim());
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return defaultDeviceName(n);
}
