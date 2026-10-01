import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfigErrorScreen } from '@/components/ConfigErrorScreen';
import { env } from '@/config/env';
import { ThemeProvider, useTheme } from '@/design';
import { bootSession } from '@/lib/bootstrap';
import { wireSignOutCleanup } from '@/lib/lifecycle';
import { usePrefs } from '@/lib/prefs';
import { configureNotificationHandler } from '@/lib/push';
import { queryClient, queryPersister, wireQueryEnvironment } from '@/lib/queryClient';
import { useSession } from '@/lib/session';
import { ToastHost } from '@/ui';

void SplashScreen.preventAutoHideAsync();
wireQueryEnvironment();
wireSignOutCleanup();
configureNotificationHandler();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });
  const status = useSession((s) => s.status);
  const prefsReady = usePrefs((s) => s.hydrated);

  useEffect(() => {
    void bootSession();
  }, []);

  const ready = (fontsLoaded || !!fontError) && status !== 'loading' && prefsReady;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{ persister: queryPersister, maxAge: 7 * 24 * 3600_000, buster: 'v2' }}
          >
            {env.apiUrl ? <RootStack signedIn={status === 'signedIn'} /> : <ConfigErrorScreen />}
            <ThemedStatusBar />
            <ToastHost />
          </PersistQueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootStack({ signedIn }: { signedIn: boolean }) {
  const t = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

function ThemedStatusBar() {
  const t = useTheme();
  return <StatusBar style={t.dark ? 'light' : 'dark'} />;
}
