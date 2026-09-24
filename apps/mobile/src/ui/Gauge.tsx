import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '@/design';
import { Text } from './Text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface GaugeProps {
  /** 0–100, or null when unknown. */
  value: number | null;
  size?: number;
  stroke?: number;
  color?: string;
  /** Optional band (e.g. moisture thresholds) drawn as a faint arc. */
  band?: { from: number; to: number };
  label?: string;
  unit?: string;
  caption?: string;
  testID?: string;
}

const SWEEP = 0.75; // 270° arc, open at the bottom

/** Animated 270° ring gauge — the hero moisture display. */
export function Gauge({
  value,
  size = 220,
  stroke = 16,
  color,
  band,
  label,
  unit = '%',
  caption,
  testID,
}: GaugeProps) {
  const t = useTheme();
  const c = color ?? t.colors.water;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * SWEEP;
  const progress = useSharedValue(0);

  useEffect(() => {
    const v = value === null ? 0 : Math.min(100, Math.max(0, value)) / 100;
    progress.set(withTiming(v, { duration: t.motion.duration.gauge, easing: Easing.out(Easing.cubic) }));
  }, [value, progress, t.motion.duration.gauge]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: arc * (1 - progress.value),
  }));

  // rotate so the gap sits at the bottom: start at 135°
  const rotation = `rotate(135 ${size / 2} ${size / 2})`;
  const bandLen = band ? (arc * Math.max(0, band.to - band.from)) / 100 : 0;
  const bandOffset = band ? -(arc * band.from) / 100 : 0;

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Gauge'}
      accessibilityValue={value === null ? { text: 'No reading' } : { min: 0, max: 100, now: Math.round(value) }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="gaugeGrad" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={c} stopOpacity={0.55} />
            <Stop offset="1" stopColor={c} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={t.colors.surfaceAlt}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          transform={rotation}
        />
        {band ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r + stroke / 2 + 6}
            stroke={t.colors.accent}
            strokeOpacity={0.45}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(bandLen * (r + stroke / 2 + 6)) / r} ${circumference * 2}`}
            strokeDashoffset={(bandOffset * (r + stroke / 2 + 6)) / r}
            transform={rotation}
          />
        ) : null}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#gaugeGrad)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          animatedProps={animatedProps}
          transform={rotation}
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        {label ? (
          <Text variant="overline" tone="textSecondary">
            {label}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <Text variant="hero" tabular style={{ fontSize: size * 0.26, lineHeight: size * 0.3 }}>
            {value === null ? '—' : Math.round(value)}
          </Text>
          {value !== null ? (
            <Text variant="heading" tone="textSecondary" style={{ marginTop: size * 0.04 }}>
              {unit}
            </Text>
          ) : null}
        </View>
        {caption ? (
          <Text variant="caption" tone="textSecondary">
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
