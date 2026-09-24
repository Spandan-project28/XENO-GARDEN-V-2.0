import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu } from 'lucide-react-native';
import { Alert } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { Badge, ListRow, toast } from '@/ui';
import { useTheme } from '@/design';

/** Firmware version + one-tap update from the server's release channel. */
export function FirmwareRow({ deviceId, online }: { deviceId: string; online: boolean }) {
  const t = useTheme();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: qk.firmware(deviceId), queryFn: () => api.devices.firmware(deviceId), staleTime: 5 * 60_000 });
  const update = useMutation({
    mutationFn: () => api.devices.updateFirmware(deviceId),
    onSuccess: () => {
      toast.info('Updating firmware', 'The device downloads, verifies and restarts. This takes about a minute.');
      setTimeout(() => void qc.invalidateQueries({ queryKey: qk.firmware(deviceId) }), 90_000);
    },
    onError: (err) => toast.error('Update could not start', errorMessage(err)),
  });
  const s = status.data;
  const confirm = () =>
    Alert.alert(`Update to ${s?.latest}?`, 'Watering pauses for about a minute while the device restarts.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Update', onPress: () => update.mutate() },
    ]);

  return (
    <ListRow
      icon={Cpu}
      title="Firmware"
      subtitle={s?.updateAvailable ? `Version ${s.latest} is available` : 'Up to date'}
      value={s?.current ?? '—'}
      right={
        s?.updateAvailable && online ? (
          <Badge label={update.isPending ? 'Starting…' : 'Update'} color={t.colors.onAccent} background={t.colors.accent} />
        ) : undefined
      }
      onPress={s?.updateAvailable && online && !update.isPending ? confirm : undefined}
      testID="firmware-row"
    />
  );
}
