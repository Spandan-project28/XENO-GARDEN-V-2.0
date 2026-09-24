import type { ProvisioningState, WifiNetwork } from '@xeno/shared';
import { Check, Loader, Lock, Signal, SignalHigh, SignalLow, SignalMedium, X } from 'lucide-react-native';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/design';
import { PressableScale, Text } from '@/ui';

/** Top progress bar for the wizard. */
export function StepProgress({ index, total }: { index: number; total: number }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: index }}
      style={{ flexDirection: 'row', gap: 6, marginBottom: t.space.xl }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= index ? t.colors.accent : t.colors.surfaceAlt }}
        />
      ))}
    </View>
  );
}

/** Radar sweep shown while looking for devices. */
export function Radar({ size = 200 }: { size?: number }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
      {[0, 1, 2].map((i) => (
        <RadarRing key={i} delay={i * 700} size={size} color={t.colors.accent} />
      ))}
      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: t.colors.accent }} />
    </View>
  );
}

function RadarRing({ delay, size, color }: { delay: number; size: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withDelay(delay, withRepeat(withTiming(1, { duration: 2100, easing: Easing.out(Easing.quad) }), -1)));
  }, [delay, p]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.6 * (1 - p.value),
    transform: [{ scale: 0.15 + p.value * 0.85 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color }, style]}
    />
  );
}

export function SignalIcon({ rssi, color }: { rssi: number | null; color: string }) {
  const Icon = rssi === null ? Signal : rssi > -60 ? SignalHigh : rssi > -72 ? SignalMedium : SignalLow;
  return <Icon size={20} color={color} />;
}

export function NetworkRow({ network, onPress }: { network: WifiNetwork; onPress: () => void }) {
  const t = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      accessibilityLabel={`${network.ssid}${network.secure ? ', secured' : ', open'}`}
      testID={`network-${network.ssid}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        padding: t.space.lg,
        borderRadius: t.radius.md,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.border,
      }}
    >
      <SignalIcon rssi={network.rssi} color={t.colors.accent} />
      <Text variant="subheading" style={{ flex: 1 }} numberOfLines={1}>
        {network.ssid}
      </Text>
      {network.secure ? <Lock size={16} color={t.colors.textTertiary} /> : null}
    </PressableScale>
  );
}

const JOIN_STEPS: { key: ProvisioningState; label: string }[] = [
  { key: 'connecting_wifi', label: 'Joining your WiFi' },
  { key: 'connecting_cloud', label: 'Reaching Xeno Garden cloud' },
  { key: 'online', label: 'Online' },
];

/** Live timeline of what the device reports while joining. */
export function JoinTimeline({ progress, failed }: { progress: ProvisioningState | null; failed: boolean }) {
  const t = useTheme();
  const order: ProvisioningState[] = ['connecting_wifi', 'connecting_cloud', 'online'];
  const failedAt = progress === 'wifi_failed' ? 0 : progress === 'cloud_failed' ? 1 : -1;
  const current = failedAt >= 0 ? failedAt : Math.max(0, order.indexOf(progress ?? 'connecting_wifi'));
  return (
    <View style={{ gap: t.space.lg }} accessibilityLiveRegion="polite">
      {JOIN_STEPS.map((s, i) => {
        const done = i < current || progress === 'online';
        const active = i === current && !done;
        const bad = failed && i === current;
        const color = bad ? t.colors.danger : done ? t.colors.accent : active ? t.colors.text : t.colors.textTertiary;
        return (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: bad ? t.colors.dangerSoft : done ? t.colors.accentSoft : t.colors.surfaceAlt,
              }}
            >
              {bad ? (
                <X size={16} color={t.colors.danger} />
              ) : done ? (
                <Check size={16} color={t.colors.accent} />
              ) : active ? (
                <ActivityIndicator size="small" color={t.colors.accent} />
              ) : (
                <Loader size={14} color={t.colors.textTertiary} />
              )}
            </View>
            <Text variant="subheading" color={color}>
              {s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
