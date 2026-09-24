import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DeviceCommandType, DeviceMode, DevicePublic, DeviceSettingsPatch, PumpCommandBody } from '@xeno/shared';
import { api, errorMessage } from '@/lib/api';
import { patchDevice, removeDevice, upsertDevice } from '@/lib/deviceCache';
import { qk } from '@/lib/queryKeys';
import { toast } from '@/ui';

/** All device-changing actions, with optimistic updates where it makes the UI feel instant. */
export function useDeviceMutations(id: string) {
  const qc = useQueryClient();
  const snapshot = () => qc.getQueryData<DevicePublic>(qk.device(id));
  const restore = (prev: DevicePublic | undefined) => prev && upsertDevice(qc, prev);

  const setMode = useMutation({
    mutationFn: (mode: DeviceMode) => api.devices.setMode(id, mode),
    onMutate: (mode) => {
      const prev = snapshot();
      patchDevice(qc, id, (d) => ({ ...d, desired: { ...d.desired, mode, manual: null }, syncPending: true }));
      return prev;
    },
    onSuccess: (d) => upsertDevice(qc, d),
    onError: (err, _v, prev) => {
      restore(prev);
      toast.error("Couldn't change mode", errorMessage(err));
    },
  });

  const pump = useMutation({
    mutationFn: (body: PumpCommandBody) => api.devices.pump(id, body),
    onSuccess: (r) => upsertDevice(qc, r.device),
    onError: (err) => toast.error("Couldn't reach the pump", errorMessage(err)),
  });

  const updateSettings = useMutation({
    mutationFn: (patch: DeviceSettingsPatch) => api.devices.updateSettings(id, patch),
    onSuccess: (d) => upsertDevice(qc, d),
    onError: (err) => toast.error("Couldn't save settings", errorMessage(err)),
  });

  const rename = useMutation({
    mutationFn: (name: string) => api.devices.update(id, { name }),
    onSuccess: (d) => upsertDevice(qc, d),
    onError: (err) => toast.error("Couldn't rename", errorMessage(err)),
  });

  const command = useMutation({
    mutationFn: (type: DeviceCommandType) => api.devices.command(id, type),
    onError: (err) => toast.error('Command failed', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => api.devices.remove(id),
    onSuccess: () => {
      removeDevice(qc, id);
      void qc.invalidateQueries({ queryKey: qk.alertsAll });
    },
    onError: (err) => toast.error("Couldn't remove the device", errorMessage(err)),
  });

  return { setMode, pump, updateSettings, rename, command, remove };
}
