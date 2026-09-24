import type { AlertPublic } from '@xeno/shared';
import { Check, CheckCheck } from 'lucide-react-native';
import { useRef } from 'react';
import { View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useTheme } from '@/design';
import { relativeTime } from '@/lib/format';
import { PressableScale, Text } from '@/ui';
import { ALERT_META, severityColors } from './meta';

export interface AlertRowProps {
  alert: AlertPublic;
  now: number;
  highlighted?: boolean;
  onPress: () => void;
  onAck: () => void;
  onResolve: () => void;
}

export function AlertRow({ alert, now, highlighted, onPress, onAck, onResolve }: AlertRowProps) {
  const t = useTheme();
  const meta = ALERT_META[alert.type];
  const Icon = meta.icon;
  const sev = severityColors(alert.severity, t.colors);
  const resolved = alert.status === 'resolved';
  const ref = useRef<SwipeableMethods>(null);

  const action = (label: string, icon: typeof Check, color: string, bg: string, fn: () => void) => {
    const I = icon;
    return (
      <PressableScale
        onPress={() => {
          ref.current?.close();
          fn();
        }}
        accessibilityLabel={label}
        style={{ width: 88, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: bg, borderRadius: t.radius.lg, marginLeft: t.space.sm }}
      >
        <I size={20} color={color} />
        <Text variant="caption" color={color}>
          {label}
        </Text>
      </PressableScale>
    );
  };

  const row = (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      scaleTo={0.99}
      accessibilityLabel={`${meta.title}${alert.deviceName ? `, ${alert.deviceName}` : ''}. ${alert.message}. ${alert.status}.`}
      accessibilityHint="Opens alert actions"
      testID={`alert-${alert.id}`}
      style={{
        flexDirection: 'row',
        gap: t.space.md,
        padding: t.space.lg,
        borderRadius: t.radius.lg,
        backgroundColor: t.colors.surface,
        borderWidth: highlighted ? 2 : 1,
        borderColor: highlighted ? sev.fg : t.colors.border,
        opacity: resolved ? 0.6 : 1,
      }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: sev.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} color={sev.fg} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <Text variant="subheading" style={{ flexShrink: 1 }} numberOfLines={1}>
            {meta.title}
          </Text>
          {alert.count > 1 ? (
            <View style={{ paddingHorizontal: 7, height: 20, borderRadius: 10, backgroundColor: sev.bg, justifyContent: 'center' }}>
              <Text variant="caption" color={sev.fg} tabular>
                ×{alert.count}
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="body" tone="textSecondary" numberOfLines={2}>
          {alert.message}
        </Text>
        <Text variant="caption" tone="textTertiary">
          {[alert.deviceName, relativeTime(alert.lastSeenAt, now), alert.status === 'acknowledged' ? 'Seen' : resolved ? 'Resolved' : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </PressableScale>
  );

  if (resolved) return row;
  return (
    <Swipeable
      ref={ref}
      friction={1.6}
      rightThreshold={48}
      overshootRight={false}
      renderRightActions={() => (
        <View style={{ flexDirection: 'row' }}>
          {alert.status === 'open' ? action('Seen', Check, t.colors.info, t.colors.waterSoft, onAck) : null}
          {action('Resolve', CheckCheck, t.colors.accent, t.colors.accentSoft, onResolve)}
        </View>
      )}
    >
      {row}
    </Swipeable>
  );
}
