import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/design';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  testID?: string;
}

/** Pill-shaped segmented control with a sliding indicator. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  testID,
}: SegmentedControlProps<T>) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = options.length ? (width - 8) / options.length : 0;

  const indicator = useAnimatedStyle(() => ({
    transform: [{ translateX: withSpring(index * segment, t.motion.snappy) }],
  }));

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        padding: 4,
        height: 52,
        borderRadius: t.radius.pill,
        backgroundColor: t.colors.surfaceAlt,
        borderWidth: 1,
        borderColor: t.colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {width > 0 ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 4,
              bottom: 4,
              left: 4,
              width: segment,
              borderRadius: t.radius.pill,
              backgroundColor: t.colors.accent,
            },
            indicator,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        const color = selected ? t.colors.onAccent : t.colors.textSecondary;
        const Icon = o.icon;
        return (
          <PressableScale
            key={o.value}
            onPress={() => !selected && onChange(o.value)}
            disabled={disabled}
            haptic="selection"
            scaleTo={0.98}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            testID={`segment-${o.value}`}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            {Icon ? <Icon size={16} color={color} strokeWidth={2.2} /> : null}
            <Text variant="label" color={color}>
              {o.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
