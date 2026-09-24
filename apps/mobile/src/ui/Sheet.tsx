import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/design';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

/** Bottom sheet: dimmed backdrop (tap to close) + card that slides up. */
export function Sheet({ visible, onClose, title, subtitle, children }: SheetProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible ? (
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View entering={FadeIn} exiting={FadeOut} style={{ position: 'absolute', inset: 0 }}>
            <Pressable
              style={{ flex: 1, backgroundColor: t.colors.overlay }}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            />
          </Animated.View>
          <Animated.View
            entering={SlideInDown.springify().damping(20)}
            exiting={SlideOutDown}
            accessibilityViewIsModal
            style={{
              backgroundColor: t.colors.surface,
              borderTopLeftRadius: t.radius.xl,
              borderTopRightRadius: t.radius.xl,
              paddingHorizontal: t.space.gutter,
              paddingTop: t.space.md,
              paddingBottom: insets.bottom + t.space.xl,
              borderWidth: 1,
              borderColor: t.colors.border,
              ...t.elevation.floating,
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 5,
                borderRadius: 3,
                backgroundColor: t.colors.borderStrong,
                marginBottom: t.space.lg,
              }}
            />
            {title ? (
              <Text variant="heading" style={{ marginBottom: subtitle ? t.space.xs : t.space.lg }}>
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text variant="body" tone="textSecondary" style={{ marginBottom: t.space.lg }}>
                {subtitle}
              </Text>
            ) : null}
            {children}
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}
