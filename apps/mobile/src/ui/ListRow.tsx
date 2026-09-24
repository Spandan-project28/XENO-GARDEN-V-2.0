import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/design';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  /** Right side: text value, or any element (Toggle…). */
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  value,
  right,
  onPress,
  destructive,
  testID,
}: ListRowProps) {
  const t = useTheme();
  const color = destructive ? t.colors.danger : (iconColor ?? t.colors.accent);
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 56, paddingVertical: t.space.sm }}>
      {Icon ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: t.radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: destructive ? t.colors.dangerSoft : t.colors.accentSoft,
          }}
        >
          <Icon size={18} color={color} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant="subheading" tone={destructive ? 'danger' : 'text'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="label" tone="textSecondary">
          {value}
        </Text>
      ) : null}
      {right}
      {onPress && !right ? <ChevronRight size={18} color={t.colors.textTertiary} /> : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <PressableScale onPress={onPress} haptic="selection" scaleTo={0.99} accessibilityLabel={title} testID={testID}>
      {body}
    </PressableScale>
  );
}

/** Groups rows on a card with hairline separators. */
export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  const t = useTheme();
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={{ gap: t.space.sm }}>
      {title ? (
        <Text variant="overline" tone="textSecondary" style={{ marginLeft: t.space.xs }}>
          {title}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: t.radius.lg,
          paddingHorizontal: t.space.lg,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 ? <View style={{ height: 1, backgroundColor: t.colors.border }} /> : null}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}
