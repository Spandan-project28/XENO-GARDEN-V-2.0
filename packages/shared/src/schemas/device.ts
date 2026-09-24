import { z } from 'zod';
import {
  CLAIM_CODE_PATTERN,
  DEFAULT_SETTINGS,
  DEVICE_COMMAND_TYPES,
  DEVICE_MODES,
  HARDWARE_ID_PATTERN,
  PUMP_ACTIONS,
  PUMP_REASONS,
  SETTINGS_LIMITS as L,
} from '../constants/index.js';
import { isoDate, objectId } from './common.js';

export const hardwareId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HARDWARE_ID_PATTERN, 'Invalid device id');
export const claimCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(CLAIM_CODE_PATTERN, 'Invalid claim code');
export const deviceMode = z.enum(DEVICE_MODES);
export const pumpAction = z.enum(PUMP_ACTIONS);
export const pumpReason = z.enum(PUMP_REASONS);

const settingsShape = z.object({
  moistureLow: z.number().min(L.moisture.min).max(L.moisture.max),
  moistureHigh: z.number().min(L.moisture.min).max(L.moisture.max),
  maxPumpRunSec: z.number().int().min(L.maxPumpRunSec.min).max(L.maxPumpRunSec.max),
  cooldownSec: z.number().int().min(L.cooldownSec.min).max(L.cooldownSec.max),
  rainLockout: z.boolean(),
  highTempC: z.number().min(L.highTempC.min).max(L.highTempC.max),
  telemetryIntervalSec: z
    .number()
    .int()
    .min(L.telemetryIntervalSec.min)
    .max(L.telemetryIntervalSec.max),
});

const moistureGapRule = (s: { moistureLow: number; moistureHigh: number }) =>
  s.moistureHigh - s.moistureLow >= L.moistureMinGap;
const moistureGapIssue = {
  message: `High threshold must be at least ${L.moistureMinGap}% above low threshold`,
  path: ['moistureHigh'],
};

/** Full irrigation settings for a device. */
export const deviceSettings = settingsShape.refine(moistureGapRule, moistureGapIssue);
export type DeviceSettings = z.infer<typeof deviceSettings>;

/** PATCH-style settings update: any subset; merged with current then re-validated as a whole. */
export const deviceSettingsPatch = settingsShape.partial();
export type DeviceSettingsPatch = z.infer<typeof deviceSettingsPatch>;

export const defaultSettings: DeviceSettings = { ...DEFAULT_SETTINGS };

/** A manual pump command carried inside the desired shadow. */
export const manualCommand = z.object({
  cmdId: z.string().min(4).max(40),
  pump: pumpAction,
  durationSec: z.number().int().min(L.manualDurationSec.min).max(L.manualDurationSec.max),
  /** Epoch ms when the command was issued (server clock). */
  issuedAt: z.number().int().nonnegative(),
  /** Epoch ms after which the command no longer applies. */
  expiresAt: z.number().int().nonnegative(),
});
export type ManualCommand = z.infer<typeof manualCommand>;

/** What the cloud wants the device to do. Written only by the backend. */
export const desiredState = z.object({
  version: z.number().int().nonnegative(),
  mode: deviceMode,
  settings: deviceSettings,
  manual: manualCommand.nullable(),
});
export type DesiredState = z.infer<typeof desiredState>;

/** What the device says is actually happening. Written only by the device. */
export const reportedState = z.object({
  /** desired.version the device has applied. */
  appliedVersion: z.number().int().nonnegative(),
  mode: deviceMode,
  pump: z.boolean(),
  pumpReason: pumpReason,
  /** cmdId of the manual command currently in effect, if any. */
  manualCmdId: z.string().max(40).nullable(),
  manualRemainingSec: z.number().int().nonnegative().nullable(),
  cooldownRemainingSec: z.number().int().nonnegative().nullable(),
  fwVersion: z.string().max(32),
  rssi: z.number().int().min(-127).max(0).nullable(),
  ssid: z.string().max(33).nullable(),
  ip: z.string().max(45).nullable(),
  uptimeSec: z.number().int().nonnegative(),
  heapFree: z.number().int().nonnegative().nullable(),
  soilCalibrated: z.boolean(),
});
export type ReportedState = z.infer<typeof reportedState>;

/** Latest sensor snapshot attached to a device in list/detail responses. */
export const latestReading = z.object({
  ts: isoDate,
  soilMoisture: z.number().nullable(),
  temperature: z.number().nullable(),
  humidity: z.number().nullable(),
  rain: z.boolean(),
  pump: z.boolean(),
});
export type LatestReading = z.infer<typeof latestReading>;

export const devicePublic = z.object({
  id: objectId,
  hardwareId: hardwareId,
  name: z.string(),
  plantId: objectId.nullable(),
  online: z.boolean(),
  lastSeenAt: isoDate.nullable(),
  claimedAt: isoDate,
  firmwareVersion: z.string().nullable(),
  desired: desiredState,
  reported: reportedState.extend({ at: isoDate }).nullable(),
  latest: latestReading.nullable(),
  /** True while the device has not yet applied the latest desired version. */
  syncPending: z.boolean(),
});
export type DevicePublic = z.infer<typeof devicePublic>;

export const deviceName = z.string().trim().min(1, 'Enter a name').max(40);

export const claimBody = z.object({
  hardwareId,
  claimCode,
  name: deviceName.optional(),
});
export type ClaimBody = z.infer<typeof claimBody>;

/** Everything the device needs to reach the cloud; written to the device over BLE. */
export const mqttCredentials = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  tls: z.boolean(),
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});
export type MqttCredentials = z.infer<typeof mqttCredentials>;

export const claimResponse = z.object({
  device: devicePublic,
  mqtt: mqttCredentials,
});
export type ClaimResponse = z.infer<typeof claimResponse>;

export const updateDeviceBody = z.object({
  name: deviceName.optional(),
  plantId: objectId.nullable().optional(),
});
export type UpdateDeviceBody = z.infer<typeof updateDeviceBody>;

export const setModeBody = z.object({ mode: deviceMode });
export type SetModeBody = z.infer<typeof setModeBody>;

export const pumpCommandBody = z.object({
  action: pumpAction,
  /** Defaults to 10 minutes for ON. For OFF it is how long automation stays paused. */
  durationSec: z
    .number()
    .int()
    .min(L.manualDurationSec.min)
    .max(L.manualDurationSec.max)
    .optional(),
});
export type PumpCommandBody = z.infer<typeof pumpCommandBody>;

export const pumpCommandResponse = z.object({
  cmdId: z.string(),
  device: devicePublic,
});
export type PumpCommandResponse = z.infer<typeof pumpCommandResponse>;

/** One-shot commands the app may send directly ('ota' goes through /firmware/update instead). */
export const deviceCommandBody = z.object({ type: z.enum(DEVICE_COMMAND_TYPES).exclude(['ota']) });
export type DeviceCommandBody = z.infer<typeof deviceCommandBody>;

/** Firmware release channel as seen by the app for one device. */
export const firmwareStatus = z.object({
  current: z.string().nullable(),
  latest: z.string().nullable(),
  updateAvailable: z.boolean(),
});
export type FirmwareStatus = z.infer<typeof firmwareStatus>;
