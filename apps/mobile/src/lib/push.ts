/**
 * Push notifications: permission, Expo push token registration with the backend, and routing
 * when the user taps a notification. Push needs a development/production build (not Expo Go on
 * Android) and an EAS project id — without them registration is skipped gracefully.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { env } from '@/config/env';
import { api } from './api';
import { queryClient } from './queryClient';
import { qk } from './queryKeys';

const TOKEN_KEY = 'xg.pushToken';

export type PushStatus = 'unsupported' | 'undetermined' | 'denied' | 'granted';

let handlerSet = false;
/** Show alerts as banners even while the app is open. */
export function configureNotificationHandler() {
  if (handlerSet || Platform.OS === 'web') return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

function supported(): boolean {
  return Platform.OS !== 'web' && Device.isDevice && !!env.easProjectId;
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('alerts', {
    name: 'Garden alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#34C77B',
  });
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/** Gets the Expo token and registers it with the backend (idempotent). */
export async function registerPushToken(ask: boolean): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  await ensureChannel();
  let status = await getPushStatus();
  if (status === 'undetermined' && ask) {
    const res = await Notifications.requestPermissionsAsync();
    status = res.status === 'granted' ? 'granted' : 'denied';
  }
  if (status !== 'granted') return status;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: env.easProjectId! });
  await api.notifications.registerToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  await AsyncStorage.setItem(TOKEN_KEY, token);
  return 'granted';
}

/** Stop pushes to this phone for the current account (called on sign-out). */
export async function unregisterPushToken() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await api.notifications.removeToken(token).catch(() => undefined);
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** Registration state + an `enable()` action for the "turn on alerts" prompt. */
export function usePushRegistration() {
  const [status, setStatus] = useState<PushStatus>('unsupported');
  useEffect(() => {
    let alive = true;
    // Refresh the token silently when permission already exists.
    void (async () => {
      const s = await getPushStatus().catch(() => 'unsupported' as const);
      if (!alive) return;
      setStatus(s);
      if (s === 'granted') await registerPushToken(false).catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, []);
  const enable = useCallback(async () => {
    const s = await registerPushToken(true).catch(() => 'denied' as const);
    setStatus(s);
    return s;
  }, []);
  return { status, enable };
}

/** Navigates to the deep link carried by a tapped notification; refreshes alerts on arrival. */
export function usePushNavigation() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const url = last.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
  }, [last]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: qk.alertsAll });
    });
    return () => sub.remove();
  }, []);
}
