import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/design';
import { PressableScale } from './PressableScale';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  variant?: 'solid' | 'glass' | 'outline' | 'tinted';
  /** Background tint for `tinted` (any colour token value). */
  tint?: string;
  padding?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function Card({
  children,
  onPress,
  variant = 'solid',
  tint,
  padding,
  style,
  accessibilityLabel,
  testID,
}: CardProps) {
  const t = useTheme();
  const base: ViewStyle = {
    borderRadius: t.radius.lg,
    padding: padding ?? t.space.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor:
      variant === 'glass'
        ? t.colors.surfaceGlass
        : variant === 'outline'
          ? 'transparent'
          : variant === 'tinted'
            ? (tint ?? t.colors.accentSoft)
            : t.colors.surface,
    ...(variant === 'solid' ? t.elevation.card : null),
  };

  if (onPress) {
    return (
      <PressableScale
        onPress={onPress}
        style={[base, style]}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {children}
      </PressableScale>
    );
  }
  return (
    <View style={[base, style]} accessibilityLabel={accessibilityLabel} testID={testID}>
      {children}
    </View>
  );
}
