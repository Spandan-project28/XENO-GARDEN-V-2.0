import type { DevicePublic } from '@xeno/shared';
import { Droplets, Power } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/design';
import { countdown, durationText } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { Card, Chip, PressableScale, Text } from '@/ui';
import { useDeviceMutations } from './mutations';
import { allowedDurations, derivePumpUi, type PendingCommand } from './pumpUi';

const BUTTON = 148;

export function PumpControl({ device }: { device: DevicePublic }) {
  const t = useTheme();
  const { pump } = useDeviceMutations(device.id);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [duration, setDuration] = useState(() => allowedDurations(device.desired.settings.maxPumpRunSec)[1] ?? 600);
  const now = useNow(1000);
  const ui = derivePumpUi(device, pending, now);
  const durations = allowedDurations(device.desired.settings.maxPumpRunSec);
  const auto = device.desired.mode === 'auto';

  const busy = ui.state === 'starting' || ui.state === 'stopping' || pump.isPending;
  const running = ui.state === 'running' || ui.state === 'stopping';

  const press = () => {
    if (busy || !device.online) return;
    const action = running ? 'OFF' : 'ON';
    pump.mutate(
      action === 'ON' ? { action, durationSec: duration } : { action },
      { onSuccess: (r) => setPending({ action, version: r.device.desired.version, since: Date.now() }) },
    );
  };

  const label = !device.online
    ? 'Device offline'
    : ui.state === 'starting'
      ? 'Starting…'
      : ui.state === 'stopping'
        ? 'Stopping…'
        : running
          ? 'Stop'
          : 'Water now';

  const sub = running
    ? ui.remainingSec !== null
      ? `${countdown(ui.remainingSec)} left`
      : 'Automatic watering'
    : auto
      ? 'Or let automation handle it'
      : `for ${durationText(duration)}`;

  return (
    <Card padding={t.space.xl}>
      <View style={{ alignItems: 'center', gap: t.space.lg }}>
        <View style={{ width: BUTTON + 40, height: BUTTON + 40, alignItems: 'center', justifyContent: 'center' }}>
          <Ripples active={running} color={t.colors.water} />
          <PressableScale
            onPress={press}
            disabled={!device.online}
            haptic="medium"
            scaleTo={0.94}
            accessibilityLabel={`${label}. ${sub}`}
            accessibilityState={{ busy, disabled: !device.online }}
            testID="pump-button"
            style={{
              width: BUTTON,
              height: BUTTON,
              borderRadius: BUTTON / 2,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              backgroundColor: running ? t.colors.water : t.colors.accent,
              ...t.elevation.floating,
            }}
          >
            {busy ? (
              <ActivityIndicator color={t.colors.onAccent} size="large" />
            ) : running ? (
              <Power size={36} color={t.colors.onAccent} strokeWidth={2.4} />
            ) : (
              <Droplets size={38} color={t.colors.onAccent} strokeWidth={2.2} />
            )}
            <Text variant="bodyStrong" color={t.colors.onAccent}>
              {label}
            </Text>
          </PressableScale>
        </View>
        <Text variant="label" tone="textSecondary" tabular testID="pump-sub">
          {sub}
        </Text>
        {!running && device.online ? (
          <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap', justifyContent: 'center' }}>
            {durations.map((s) => (
              <Chip
                key={s}
                label={durationText(s)}
                selected={s === duration}
                onPress={() => setDuration(s)}
                tone={t.colors.water}
                testID={`duration-${s}`}
              />
            ))}
          </View>
        ) : null}
        {ui.unconfirmed ? (
          <Text variant="caption" tone="warning" align="center" testID="pump-unconfirmed">
            The device hasn&apos;t confirmed yet. It may be out of WiFi range and will apply the command when it reconnects.
          </Text>
        ) : null}
        {running && auto && ui.state === 'running' ? (
          <Text variant="caption" tone="textTertiary" align="center">
            Stopping pauses automatic watering for 30 min.
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/** Concentric expanding rings while water flows. */
function Ripples({ active, color }: { active: boolean; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(active ? withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1) : 0);
  }, [active, p]);
  const ring = {
    position: 'absolute' as const,
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    borderWidth: 2,
    borderColor: color,
  };
  // two rings half a cycle apart
  const a = useAnimatedStyle(() => ({ opacity: active ? 0.5 * (1 - p.value) : 0, transform: [{ scale: 1 + p.value * 0.3 }] }));
  const b = useAnimatedStyle(() => {
    const v = (p.value + 0.5) % 1;
    return { opacity: active ? 0.5 * (1 - v) : 0, transform: [{ scale: 1 + v * 0.3 }] };
  });
  return (
    <>
      <Animated.View pointerEvents="none" style={[ring, a]} />
      <Animated.View pointerEvents="none" style={[ring, b]} />
    </>
  );
}
