/**
 * Pure helpers that patch cached device data from realtime events and mutation results, so the
 * UI updates instantly without refetching.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { DevicePublic, RtShadow, RtStatus, RtTelemetry } from '@xeno/shared';
import { qk } from './queryKeys';

type Patch = (d: DevicePublic) => DevicePublic;

const syncPending = (d: DevicePublic) => !d.reported || d.reported.appliedVersion < d.desired.version;

export function patchDevice(qc: QueryClient, id: string, patch: Patch) {
  qc.setQueryData<DevicePublic[]>(qk.devices, (list) => list?.map((d) => (d.id === id ? patch(d) : d)));
  qc.setQueryData<DevicePublic>(qk.device(id), (d) => (d ? patch(d) : d));
}

export function upsertDevice(qc: QueryClient, device: DevicePublic) {
  qc.setQueryData<DevicePublic[]>(qk.devices, (list) => {
    if (!list) return list;
    return list.some((d) => d.id === device.id)
      ? list.map((d) => (d.id === device.id ? device : d))
      : [...list, device];
  });
  qc.setQueryData(qk.device(device.id), device);
}

export function removeDevice(qc: QueryClient, id: string) {
  qc.setQueryData<DevicePublic[]>(qk.devices, (list) => list?.filter((d) => d.id !== id));
  qc.removeQueries({ queryKey: qk.device(id) });
}

export const applyTelemetry = (e: RtTelemetry): Patch => (d) => ({
  ...d,
  online: true,
  lastSeenAt: e.at,
  latest: {
    ts: e.at,
    soilMoisture: e.soilMoisture,
    temperature: e.temperature,
    humidity: e.humidity,
    rain: e.rain,
    pump: e.pump,
  },
});

export const applyShadow = (e: RtShadow): Patch => (d) => {
  const next: DevicePublic = {
    ...d,
    desired: e.desired ?? d.desired,
    reported: e.reported ?? d.reported,
    firmwareVersion: e.reported?.fwVersion ?? d.firmwareVersion,
  };
  return { ...next, syncPending: syncPending(next) };
};

export const applyStatus = (e: RtStatus): Patch => (d) => ({
  ...d,
  online: e.online,
  lastSeenAt: e.online ? e.at : d.lastSeenAt,
});
