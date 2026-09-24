import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useTheme } from '@/design';
import { queryClient } from '@/lib/queryClient';
import { realtime } from '@/lib/realtime';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function AppLayout() {
  const t = useTheme();
  useEffect(() => {
    void realtime.start(queryClient);
    return () => realtime.stop();
  }, []);
  return (
    <Stack
      screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: t.colors.bg } }}
    />
  );
}
