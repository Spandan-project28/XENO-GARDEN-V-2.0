import { Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/design';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
  icon?: LucideIcon;
  /** Shows a show/hide toggle for passwords. */
  secure?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, icon: Icon, secure, onFocus, onBlur, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const borderColor = error ? t.colors.danger : focused ? t.colors.accent : t.colors.border;

  return (
    <View style={{ gap: t.space.xs }}>
      <Text variant="label" tone="textSecondary">
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.sm,
          height: 56,
          paddingHorizontal: t.space.lg,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.surfaceAlt,
          borderWidth: 1.5,
          borderColor,
        }}
      >
        {Icon ? <Icon size={18} color={focused ? t.colors.accent : t.colors.textTertiary} /> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={t.colors.textTertiary}
          selectionColor={t.colors.accent}
          secureTextEntry={secure && hidden}
          autoCorrect={false}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[t.type.body, { flex: 1, color: t.colors.text, height: '100%' }]}
        />
        {secure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
          >
            {hidden ? (
              <Eye size={20} color={t.colors.textTertiary} />
            ) : (
              <EyeOff size={20} color={t.colors.textTertiary} />
            )}
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
