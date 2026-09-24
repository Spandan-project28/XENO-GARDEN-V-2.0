import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { useTheme } from '@/design';
import { Button } from './Button';
import { Text } from './Text';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: string;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, message, actionLabel, onAction, tone, compact }: EmptyStateProps) {
  const t = useTheme();
  const color = tone ?? t.colors.accent;
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? t.space.xxl : t.space.huge, gap: t.space.md }}>
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.colors.accentSoft,
          marginBottom: t.space.sm,
        }}
      >
        <Icon size={38} color={color} strokeWidth={1.8} />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="body" tone="textSecondary" align="center" style={{ maxWidth: 320 }}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} style={{ marginTop: t.space.md }} />
      ) : null}
    </View>
  );
}
