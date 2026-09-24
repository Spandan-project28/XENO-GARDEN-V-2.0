import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/design';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon: Icon,
  loading,
  disabled,
  fullWidth,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  const t = useTheme();
  const c = t.colors;
  const palette = {
    primary: { bg: c.accent, fg: c.onAccent, border: c.accent },
    secondary: { bg: c.surfaceAlt, fg: c.text, border: c.borderStrong },
    ghost: { bg: 'transparent', fg: c.accent, border: 'transparent' },
    danger: { bg: c.dangerSoft, fg: c.danger, border: c.dangerSoft },
  }[variant];
  const height = size === 'lg' ? 56 : 44;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      haptic={variant === 'ghost' ? 'selection' : 'light'}
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      testID={testID}
      style={[
        {
          height,
          minWidth: t.layout.minTouch,
          paddingHorizontal: size === 'lg' ? t.space.xxl : t.space.lg,
          borderRadius: t.radius.pill,
          backgroundColor: palette.bg,
          borderWidth: 1,
          borderColor: palette.border,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: fullWidth ? 'stretch' : 'auto',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          {Icon ? <Icon size={size === 'lg' ? 20 : 18} color={palette.fg} strokeWidth={2.2} /> : null}
          <Text variant={size === 'lg' ? 'bodyStrong' : 'label'} color={palette.fg}>
            {title}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}

export interface IconButtonProps {
  icon: LucideIcon;
  onPress?: () => void;
  accessibilityLabel: string;
  variant?: 'plain' | 'filled';
  size?: number;
  color?: string;
  disabled?: boolean;
  testID?: string;
}

export function IconButton({
  icon: Icon,
  onPress,
  accessibilityLabel,
  variant = 'filled',
  size = 44,
  color,
  disabled,
  testID,
}: IconButtonProps) {
  const t = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="selection"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      testID={testID}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: variant === 'filled' ? t.colors.surfaceAlt : 'transparent',
        borderWidth: variant === 'filled' ? 1 : 0,
        borderColor: t.colors.border,
      }}
    >
      <Icon size={size * 0.45} color={color ?? t.colors.text} strokeWidth={2} />
    </PressableScale>
  );
}
