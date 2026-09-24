import { defaultSettings, type DevicePublic, type ReportedState } from '@xeno/shared';

export const reported = (over: Partial<ReportedState & { at: string }> = {}): ReportedState & { at: string } => ({
  appliedVersion: 1,
  mode: 'auto',
  pump: false,
  pumpReason: 'hold',
  manualCmdId: null,
  manualRemainingSec: null,
  cooldownRemainingSec: null,
  fwVersion: '2.0.0',
  rssi: -58,
  ssid: 'Home WiFi',
  ip: '192.0.2.10',
  uptimeSec: 3600,
  heapFree: 150000,
  soilCalibrated: true,
  at: new Date().toISOString(),
  ...over,
});

export const makeDevice = (over: Partial<DevicePublic> = {}): DevicePublic => ({
  id: 'aaaaaaaaaaaaaaaaaaaaaaa1',
  hardwareId: 'xg-aabbccddeeff',
  name: 'Balcony tomatoes',
  plantId: null,
  online: true,
  lastSeenAt: new Date().toISOString(),
  claimedAt: '2026-01-01T00:00:00.000Z',
  firmwareVersion: '2.0.0',
  desired: { version: 1, mode: 'auto', settings: { ...defaultSettings }, manual: null },
  reported: reported(),
  latest: {
    ts: new Date().toISOString(),
    soilMoisture: 38.4,
    temperature: 26.1,
    humidity: 55,
    rain: false,
    pump: false,
  },
  syncPending: false,
  ...over,
});
