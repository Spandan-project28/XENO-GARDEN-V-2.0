import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/tabs';
import type { LucideIcon } from 'lucide-react-native';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/design';
import { PressableScale, Text } from '@/ui';

export interface TabMeta {
  icon: LucideIcon;
  label: string;
  badge?: number;
}

/** Floating glass tab bar with an animated active pill. */
export function TabBar({ state, descriptors, navigation, meta }: BottomTabBarProps & { meta: Record<string, TabMeta> }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, t.space.md), alignItems: 'center' }}
    >
      <View
        style={{
          flexDirection: 'row',
          height: t.layout.tabBarHeight,
          width: '92%',
          maxWidth: 480,
          borderRadius: t.radius.pill,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: t.colors.borderStrong,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : t.colors.tabBar,
          ...t.elevation.floating,
        }}
      >
        {Platform.OS === 'ios' ? (
          <BlurView intensity={40} tint={t.dark ? 'dark' : 'light'} style={{ position: 'absolute', inset: 0, backgroundColor: t.colors.tabBar }} />
        ) : null}
        {state.routes.map((route, index) => {
          const m = meta[route.name];
          if (!m) return null;
          const focused = state.index === index;
          const { options } = descriptors[route.key]!;
          return (
            <TabItem
              key={route.key}
              meta={m}
              focused={focused}
              label={options.tabBarAccessibilityLabel ?? m.label}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabItem({ meta, focused, label, onPress }: { meta: TabMeta; focused: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  const Icon = meta.icon;
  const pill = useAnimatedStyle(() => ({
    opacity: withSpring(focused ? 1 : 0, t.motion.snappy),
    transform: [{ scale: withSpring(focused ? 1 : 0.6, t.motion.snappy) }],
  }));
  const color = focused ? t.colors.onAccent : t.colors.textSecondary;
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.badge ? `${label}, ${meta.badge} new` : label}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        style={[
          { position: 'absolute', height: 44, left: 6, right: 6, borderRadius: t.radius.pill, backgroundColor: t.colors.accent },
          pill,
        ]}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View>
          <Icon size={21} color={color} strokeWidth={focused ? 2.4 : 2} />
          {meta.badge ? (
            <View
              style={{
                position: 'absolute',
                top: -5,
                right: -8,
                minWidth: 17,
                height: 17,
                paddingHorizontal: 4,
                borderRadius: 9,
                backgroundColor: t.colors.danger,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: t.colors.surface,
              }}
            >
              <Text variant="overline" color="#FFFFFF" style={{ fontSize: 9, lineHeight: 11, letterSpacing: 0 }}>
                {meta.badge > 9 ? '9+' : meta.badge}
              </Text>
            </View>
          ) : null}
        </View>
        {focused ? (
          <Text variant="caption" color={color} numberOfLines={1}>
            {meta.label}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}
