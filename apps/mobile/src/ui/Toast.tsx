import * as Haptics from 'expo-haptics';
import { CheckCircle2, Info, XCircle } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useTheme } from '@/design';
import { Text } from './Text';

export type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastState {
  items: ToastItem[];
  show: (t: Omit<ToastItem, 'id'>, durationMs?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  show: (item, durationMs = 3200) => {
    const id = ++seq;
    set({ items: [...get().items.slice(-2), { ...item, id }] });
    if (item.kind === 'error') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else if (item.kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => get().dismiss(id), durationMs);
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}));

/** Imperative helpers usable outside React (e.g. in mutation callbacks). */
export const toast = {
  success: (title: string, message?: string) => useToasts.getState().show({ kind: 'success', title, message }),
  error: (title: string, message?: string) => useToasts.getState().show({ kind: 'error', title, message }, 4500),
  info: (title: string, message?: string) => useToasts.getState().show({ kind: 'info', title, message }),
};

/** Mount once at the root. */
export function ToastHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const items = useToasts((s) => s.items);
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + t.space.sm, left: t.space.lg, right: t.space.lg, gap: t.space.sm }}
    >
      {items.map((i) => {
        const Icon = i.kind === 'success' ? CheckCircle2 : i.kind === 'error' ? XCircle : Info;
        const color = i.kind === 'success' ? t.colors.success : i.kind === 'error' ? t.colors.danger : t.colors.info;
        return (
          <Animated.View
            key={i.id}
            entering={FadeInUp.springify().damping(18)}
            exiting={FadeOutUp}
            layout={LinearTransition}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.space.md,
              padding: t.space.md,
              paddingHorizontal: t.space.lg,
              borderRadius: t.radius.lg,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.borderStrong,
              ...t.elevation.floating,
            }}
          >
            <Icon size={22} color={color} />
            <View style={{ flex: 1 }}>
              <Text variant="label">{i.title}</Text>
              {i.message ? (
                <Text variant="caption" tone="textSecondary">
                  {i.message}
                </Text>
              ) : null}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}
