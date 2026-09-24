import { useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/design';

/** Placeholder block that breathes while content loads. Never show spinners on blank screens. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius ?? t.radius.sm, backgroundColor: t.colors.skeleton },
        anim,
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton matching the device card layout. */
export function SkeletonCard({ height = 180 }: { height?: number }) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel="Loading"
      style={{
        height,
        borderRadius: t.radius.lg,
        padding: t.space.lg,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.border,
        gap: t.space.md,
      }}
    >
      <Skeleton width="45%" height={18} />
      <Skeleton width="30%" height={40} />
      <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: 'auto' }}>
        <Skeleton width="30%" height={28} radius={t.radius.pill} />
        <Skeleton width="30%" height={28} radius={t.radius.pill} />
        <Skeleton width="30%" height={28} radius={t.radius.pill} />
      </View>
    </View>
  );
}
