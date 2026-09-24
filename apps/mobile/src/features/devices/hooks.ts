import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DevicePublic } from '@xeno/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useDevices() {
  return useQuery({ queryKey: qk.devices, queryFn: api.devices.list });
}

/** Single device; starts from the list cache so detail screens open instantly. */
export function useDevice(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.device(id),
    queryFn: () => api.devices.get(id),
    initialData: () => qc.getQueryData<DevicePublic[]>(qk.devices)?.find((d) => d.id === id),
    initialDataUpdatedAt: () => qc.getQueryState(qk.devices)?.dataUpdatedAt,
  });
}

/** What the pump is actually doing right now, per the device's own report. */
export function pumpState(d: DevicePublic) {
  const r = d.reported;
  const on = r?.pump ?? d.latest?.pump ?? false;
  return { on, reason: r?.pumpReason ?? null, manualRemainingSec: r?.manualRemainingSec ?? null };
}
