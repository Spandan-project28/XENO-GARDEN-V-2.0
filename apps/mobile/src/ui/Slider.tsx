import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '@/design';

const THUMB = 28;

export const snap = (v: number, min: number, max: number, step: number) => {
  'worklet';
  const clamped = Math.min(max, Math.max(min, v));
  return Math.round((clamped - min) / step) * step + min;
};

interface CommonProps {
  min: number;
  max: number;
  step?: number;
  color?: string;
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
}

export interface RangeSliderProps extends CommonProps {
  low: number;
  high: number;
  /** Minimum distance between thumbs. */
  minGap?: number;
  onChange: (low: number, high: number) => void;
}

/** Two-thumb slider (e.g. moisture low/high thresholds). Reports values live while dragging. */
export function RangeSlider({
  min,
  max,
  step = 1,
  low,
  high,
  minGap = 0,
  onChange,
  color,
  disabled,
  accessibilityLabel,
  testID,
}: RangeSliderProps) {
  const t = useTheme();
  const c = color ?? t.colors.accent;
  const [width, setWidth] = useState(0);
  const usable = Math.max(1, width - THUMB);
  const toX = (v: number) => ((v - min) / (max - min)) * usable;

  const lowX = useSharedValue(0);
  const highX = useSharedValue(0);
  useEffect(() => {
    lowX.set(toX(low));
    highX.set(toX(high));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [low, high, width]);

  const emit = (l: number, h: number) => {
    void Haptics.selectionAsync();
    onChange(l, h);
  };

  const start = useSharedValue(0);
  const lastLow = useSharedValue(low);
  const lastHigh = useSharedValue(high);
  const gapPx = (minGap / (max - min)) * usable;

  const toValue = (px: number) => {
    'worklet';
    return snap(min + (px / usable) * (max - min), min, max, step);
  };

  const lowPan = Gesture.Pan()
    .enabled(!disabled)
    .hitSlop(12)
    .onBegin(() => {
      'worklet';
      start.set(lowX.value);
    })
    .onUpdate((e) => {
      'worklet';
      lowX.set(Math.min(Math.max(0, start.value + e.translationX), highX.value - gapPx));
      const v = toValue(lowX.value);
      if (v !== lastLow.value) {
        lastLow.set(v);
        scheduleOnRN(emit, v, toValue(highX.value));
      }
    });

  const highPan = Gesture.Pan()
    .enabled(!disabled)
    .hitSlop(12)
    .onBegin(() => {
      'worklet';
      start.set(highX.value);
    })
    .onUpdate((e) => {
      'worklet';
      highX.set(Math.max(Math.min(usable, start.value + e.translationX), lowX.value + gapPx));
      const v = toValue(highX.value);
      if (v !== lastHigh.value) {
        lastHigh.set(v);
        scheduleOnRN(emit, toValue(lowX.value), v);
      }
    });

  const lowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lowX.value }] }));
  const highStyle = useAnimatedStyle(() => ({ transform: [{ translateX: highX.value }] }));
  const fill = useAnimatedStyle(() => ({ left: lowX.value + THUMB / 2, width: highX.value - lowX.value }));

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: `${low} to ${high}` }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: THUMB + 8, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={{
          position: 'absolute',
          left: THUMB / 2,
          right: THUMB / 2,
          height: 6,
          borderRadius: 3,
          backgroundColor: t.colors.surfaceAlt,
        }}
      />
      <Animated.View style={[{ position: 'absolute', height: 6, borderRadius: 3, backgroundColor: c }, fill]} />
      {width > 0 ? (
        <>
          <GestureDetector gesture={lowPan}>
            <Animated.View style={[thumbStyle(t.colors.surface, c), lowStyle]} />
          </GestureDetector>
          <GestureDetector gesture={highPan}>
            <Animated.View style={[thumbStyle(t.colors.surface, c), highStyle]} />
          </GestureDetector>
        </>
      ) : null}
    </View>
  );
}

export interface SliderProps extends CommonProps {
  value: number;
  onChange: (v: number) => void;
}

/** Single-thumb slider. */
export function Slider({ min, max, step = 1, value, onChange, color, disabled, accessibilityLabel, testID }: SliderProps) {
  const t = useTheme();
  const c = color ?? t.colors.accent;
  const [width, setWidth] = useState(0);
  const usable = Math.max(1, width - THUMB);
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const last = useSharedValue(value);
  useEffect(() => {
    x.set(((value - min) / (max - min)) * usable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, width]);

  const emit = (v: number) => {
    void Haptics.selectionAsync();
    onChange(v);
  };
  const pan = Gesture.Pan()
    .enabled(!disabled)
    .hitSlop(12)
    .onBegin(() => {
      'worklet';
      start.set(x.value);
    })
    .onUpdate((e) => {
      'worklet';
      const nx = Math.min(usable, Math.max(0, start.value + e.translationX));
      x.set(nx);
      const v = snap(min + (nx / usable) * (max - min), min, max, step);
      if (v !== last.value) {
        last.set(v);
        scheduleOnRN(emit, v);
      }
    });
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fill = useAnimatedStyle(() => ({ width: x.value + THUMB / 2 }));

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        onChange(snap(value + (e.nativeEvent.actionName === 'increment' ? step : -step), min, max, step))
      }
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: THUMB + 8, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={{ position: 'absolute', left: THUMB / 2, right: THUMB / 2, height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceAlt }}
      />
      <Animated.View style={[{ position: 'absolute', left: THUMB / 2, height: 6, borderRadius: 3, backgroundColor: c }, fill]} />
      {width > 0 ? (
        <GestureDetector gesture={pan}>
          <Animated.View style={[thumbStyle(t.colors.surface, c), thumb]} />
        </GestureDetector>
      ) : null}
    </View>
  );
}

const thumbStyle = (bg: string, border: string) => ({
  position: 'absolute' as const,
  left: 0,
  width: THUMB,
  height: THUMB,
  borderRadius: THUMB / 2,
  backgroundColor: bg,
  borderWidth: 3,
  borderColor: border,
});
