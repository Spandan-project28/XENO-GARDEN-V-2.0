import * as Haptics from 'expo-haptics';
import { Pressable } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/design';

export interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
}

/** Custom animated switch (consistent look on iOS, Android and web). */
export function Toggle({ value, onChange, disabled, accessibilityLabel, testID }: ToggleProps) {
  const t = useTheme();
  const p = useDerivedValue(() => withSpring(value ? 1 : 0, t.motion.snappy), [value]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [t.colors.surfaceAlt, t.colors.accent]),
    borderColor: interpolateColor(p.value, [0, 1], [t.colors.borderStrong, t.colors.accent]),
  }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: p.value * 20 }] }));

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={10}
      onPress={() => {
        void Haptics.selectionAsync();
        onChange(!value);
      }}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View style={[{ width: 52, height: 32, borderRadius: 16, borderWidth: 1, padding: 3 }, track]}>
        <Animated.View
          style={[
            { width: 24, height: 24, borderRadius: 12, backgroundColor: value ? t.colors.onAccent : t.colors.textSecondary },
            knob,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
