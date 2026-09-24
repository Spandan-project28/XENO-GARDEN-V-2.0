import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme, type Palette, type TypeVariant } from '@/design';

export type TextTone = keyof Pick<
  Palette,
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'accent'
  | 'onAccent'
  | 'water'
  | 'sun'
  | 'humidity'
  | 'rain'
  | 'warning'
  | 'danger'
  | 'info'
>;

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  tone?: TextTone;
  /** Raw colour override — prefer `tone`. */
  color?: string;
  align?: TextStyle['textAlign'];
  /** Fixed-width digits so live numbers don't jitter. */
  tabular?: boolean;
}

export function Text({ variant = 'body', tone = 'text', color, align, tabular, style, ...rest }: TextProps) {
  const t = useTheme();
  const v = t.type[variant];
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        v,
        { color: color ?? t.colors[tone] },
        align ? { textAlign: align } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}
