import { AlertTriangle, Info, WifiOff, XCircle, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useTheme } from '@/design';
import { Text } from './Text';

export type BannerTone = 'info' | 'warning' | 'danger' | 'offline';

export function Banner({
  tone = 'info',
  title,
  message,
  action,
  icon,
}: {
  tone?: BannerTone;
  title: string;
  message?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  const t = useTheme();
  const map = {
    info: { fg: t.colors.info, bg: t.colors.waterSoft, icon: Info },
    warning: { fg: t.colors.warning, bg: t.colors.warningSoft, icon: AlertTriangle },
    danger: { fg: t.colors.danger, bg: t.colors.dangerSoft, icon: XCircle },
    offline: { fg: t.colors.textSecondary, bg: t.colors.surfaceAlt, icon: WifiOff },
  }[tone];
  const Icon = icon ?? map.icon;
  return (
    <Animated.View entering={FadeInUp.springify()} exiting={FadeOutUp} accessible accessibilityRole="alert">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.md,
          padding: t.space.md,
          borderRadius: t.radius.md,
          backgroundColor: map.bg,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <Icon size={20} color={map.fg} />
        <View style={{ flex: 1 }}>
          <Text variant="label" color={map.fg}>
            {title}
          </Text>
          {message ? (
            <Text variant="caption" tone="textSecondary">
              {message}
            </Text>
          ) : null}
        </View>
        {action}
      </View>
    </Animated.View>
  );
}
