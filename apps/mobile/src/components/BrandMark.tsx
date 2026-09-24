import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '@/design';

/** Xeno Garden mark: a leaf cradling a water drop, with a soft breathing glow. */
export function BrandMark({ size = 120, animated = true }: { size?: number; animated?: boolean }) {
  const t = useTheme();
  const glow = useSharedValue(0);
  const drop = useSharedValue(0);

  useEffect(() => {
    if (!animated) return;
    glow.set(withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true));
    drop.set(
      withRepeat(
        withSequence(
          withDelay(1200, withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) })),
          withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
  }, [animated, glow, drop]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.35 + glow.value * 0.4, transform: [{ scale: 1 + glow.value * 0.08 }] }));
  const dropStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drop.value * 4 }] }));

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Xeno Garden"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, glowStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={t.colors.accent} stopOpacity={0.55} />
              <Stop offset="1" stopColor={t.colors.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#glow)" />
        </Svg>
      </Animated.View>
      <Svg width={size * 0.62} height={size * 0.62} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="leaf" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={t.colors.accent} stopOpacity={0.75} />
            <Stop offset="1" stopColor={t.colors.accent} />
          </LinearGradient>
        </Defs>
        <Path
          d="M18 82 C 14 44, 42 14, 88 12 C 88 58, 60 86, 18 82 Z"
          fill="url(#leaf)"
        />
        <Path d="M22 78 C 42 60, 58 44, 78 22" stroke={t.colors.onAccent} strokeOpacity={0.55} strokeWidth={4} strokeLinecap="round" fill="none" />
      </Svg>
      <Animated.View style={[{ position: 'absolute', right: size * 0.2, bottom: size * 0.16 }, dropStyle]}>
        <Svg width={size * 0.22} height={size * 0.28} viewBox="0 0 22 28">
          <Path d="M11 1 C 11 1, 21 13, 21 18 A 10 10 0 0 1 1 18 C 1 13, 11 1, 11 1 Z" fill={t.colors.water} />
          <Path d="M6 18 a 5 5 0 0 0 4 5" stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}
