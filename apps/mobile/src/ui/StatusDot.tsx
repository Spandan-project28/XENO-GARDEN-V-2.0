import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/design';
import { Text } from './Text';

/** Small status dot; pulses when `pulse` (e.g. device online, pump running). */
export function StatusDot({ color, pulse, size = 8 }: { color: string; pulse?: boolean; size?: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(pulse ? withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1) : 0);
  }, [pulse, p]);
  const ring = useAnimatedStyle(() => ({
    opacity: 0.6 * (1 - p.value),
    transform: [{ scale: 1 + p.value * 1.6 }],
  }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {pulse ? (
        <Animated.View
          style={[{ position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color }, ring]}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

/** Rounded label with optional dot — for "Online", "Watering", severities… */
export function Badge({
  label,
  color,
  background,
  dot,
  pulse,
}: {
  label: string;
  color: string;
  background?: string;
  dot?: boolean;
  pulse?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        paddingHorizontal: 10,
        height: 26,
        borderRadius: t.radius.pill,
        backgroundColor: background ?? t.colors.surfaceAlt,
      }}
    >
      {dot ? <StatusDot color={color} pulse={pulse} size={7} /> : null}
      <Text variant="caption" color={color}>
        {label}
      </Text>
    </View>
  );
}
