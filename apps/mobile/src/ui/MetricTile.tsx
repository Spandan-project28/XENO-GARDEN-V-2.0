import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { useTheme } from '@/design';
import { Text } from './Text';

export interface MetricTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  color: string;
  background: string;
  hint?: string;
  testID?: string;
}

/** Compact sensor tile: icon bubble, value + unit, label. */
export function MetricTile({ icon: Icon, label, value, unit, color, background, hint, testID }: MetricTileProps) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${label}: ${value}${unit ?? ''}${hint ? `, ${hint}` : ''}`}
      style={{
        flex: 1,
        minWidth: 96,
        padding: t.space.md,
        borderRadius: t.radius.md,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.border,
        gap: t.space.sm,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
        }}
      >
        <Icon size={17} color={color} strokeWidth={2.2} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
        <Text variant="metric" tabular numberOfLines={1}>
          {value}
        </Text>
        {unit ? (
          <Text variant="caption" tone="textSecondary">
            {unit}
          </Text>
        ) : null}
      </View>
      <Text variant="caption" tone="textSecondary" numberOfLines={1}>
        {hint ?? label}
      </Text>
    </View>
  );
}
