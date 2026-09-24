import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/design';
import { Text } from './Text';

export interface ScreenProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  /** Small label above the title (e.g. greeting). */
  eyebrow?: string;
  /** Element on the right of the header (icon buttons). */
  headerRight?: ReactNode;
  /** Element on the left of the header (back button). */
  headerLeft?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Leave room for the floating tab bar. */
  withTabBar?: boolean;
  keyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Rendered above the content, full width (e.g. offline banner). */
  top?: ReactNode;
  testID?: string;
}

export function Screen({
  children,
  title,
  subtitle,
  eyebrow,
  headerRight,
  headerLeft,
  scroll = true,
  refreshing,
  onRefresh,
  withTabBar,
  keyboard,
  contentStyle,
  top,
  testID,
}: ScreenProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom + (withTabBar ? t.layout.tabBarHeight + t.space.xxl : t.space.xxl);

  const header =
    title || headerLeft || headerRight ? (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: t.space.md,
          marginBottom: t.space.xl,
          minHeight: 44,
        }}
      >
        {headerLeft}
        <View style={{ flex: 1 }}>
          {eyebrow ? (
            <Text variant="overline" tone="textSecondary" style={{ marginBottom: t.space.xs }}>
              {eyebrow}
            </Text>
          ) : null}
          {title ? (
            <Text variant="title" accessibilityRole="header" numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text variant="body" tone="textSecondary" style={{ marginTop: t.space.xs }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {headerRight ? <View style={{ flexDirection: 'row', gap: t.space.sm }}>{headerRight}</View> : null}
      </View>
    ) : null;

  const inner: ViewStyle = {
    paddingTop: insets.top + t.space.md,
    paddingHorizontal: t.space.gutter,
    paddingBottom: bottomPad,
    width: '100%',
    maxWidth: t.layout.maxContentWidth,
    alignSelf: 'center',
  };

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[inner, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.accent}
            colors={[t.colors.accent]}
            progressViewOffset={insets.top}
          />
        ) : undefined
      }
    >
      {header}
      {children}
    </ScrollView>
  ) : (
    <View style={[inner, { flex: 1 }, contentStyle]}>
      {header}
      {children}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }} testID={testID}>
      <LinearGradient colors={t.colors.bgGradient} style={{ position: 'absolute', inset: 0 }} />
      {top}
      {keyboard ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </View>
  );
}
