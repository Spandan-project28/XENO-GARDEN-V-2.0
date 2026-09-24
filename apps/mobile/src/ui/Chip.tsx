import type { LucideIcon } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useTheme } from '@/design';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  tone?: string;
  testID?: string;
}

export function Chip({ label, selected, onPress, icon: Icon, tone, testID }: ChipProps) {
  const t = useTheme();
  const active = tone ?? t.colors.accent;
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
        height: 36,
        paddingHorizontal: t.space.lg,
        borderRadius: t.radius.pill,
        backgroundColor: selected ? active : t.colors.surfaceAlt,
        borderWidth: 1,
        borderColor: selected ? active : t.colors.border,
      }}
    >
      {Icon ? <Icon size={15} color={selected ? t.colors.onAccent : t.colors.textSecondary} /> : null}
      <Text variant="label" color={selected ? t.colors.onAccent : t.colors.textSecondary}>
        {label}
      </Text>
    </PressableScale>
  );
}

export interface ChipGroupProps<T extends string> {
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (v: T) => void;
  scrollable?: boolean;
}

export function ChipGroup<T extends string>({ options, value, onChange, scrollable }: ChipGroupProps<T>) {
  const t = useTheme();
  const chips = options.map((o) => (
    <Chip
      key={o.value}
      label={o.label}
      icon={o.icon}
      selected={o.value === value}
      onPress={() => onChange(o.value)}
      testID={`chip-${o.value}`}
    />
  ));
  if (scrollable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space.sm }}>
        {chips}
      </ScrollView>
    );
  }
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>{chips}</View>;
}
