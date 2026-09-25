/**
 * Push notifications: permission, Expo push token registration with the backend, and routing
 * when the user taps a notification. Push needs a development/production build (not Expo Go on
 * Android) and an EAS project id — without them registration is skipped gracefully.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { env } from '@/config/env';
import { api } from './api';
import { queryClient } from './queryClient';
import { qk } from './queryKeys';

const TOKEN_KEY = 'xg.pushToken';

export type PushStatus = 'unsupported' | 'undetermined' | 'denied' | 'granted';

type NotificationsModule = typeof import('expo-notifications');

/**
 * expo-notifications throws at import time inside Expo Go on Android (remote push was removed
 * there in SDK 53), so it is loaded lazily and only where it can work.
 */
let notificationsModule: NotificationsModule | null | undefined;
function notifications(): NotificationsModule | null {
  if (notificationsModule !== undefined) return notificationsModule;
  if (
    Platform.OS === 'web' ||
    (Platform.OS === 'android' &&
      Constants.executionEnvironment === ExecutionEnvironment.StoreClient)
  ) {
    notificationsModule = null;
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      notificationsModule = require('expo-notifications') as NotificationsModule;
    } catch {
      notificationsModule = null;
    }
  }
  return notificationsModule;
}

let handlerSet = false;
/** Show alerts as banners even while the app is open. */
export function configureNotificationHandler() {
  const Notifications = notifications();
  if (handlerSet || !Notifications) return;
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
  return Device.isDevice && !!env.easProjectId && notifications() !== null;
}

async function ensureChannel(Notifications: NotificationsModule) {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('alerts', {
    name: 'Garden alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#34C77B',
  });
}

export async function getPushStatus(): Promise<PushStatus> {
  const Notifications = notifications();
  if (!supported() || !Notifications) return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/** Gets the Expo token and registers it with the backend (idempotent). */
export async function registerPushToken(ask: boolean): Promise<PushStatus> {
  const Notifications = notifications();
  if (!supported() || !Notifications) return 'unsupported';
  await ensureChannel(Notifications);
  let status = await getPushStatus();
  if (status === 'undetermined' && ask) {
    const res = await Notifications.requestPermissionsAsync();
    status = res.status === 'granted' ? 'granted' : 'denied';
  }
  if (status !== 'granted') return status;
  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId: env.easProjectId!,
  });
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
  useEffect(() => {
    const Notifications = notifications();
    if (!Notifications) return;
    const open = (res: import('expo-notifications').NotificationResponse | null) => {
      if (!res || res.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const url = res.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
    };
    // Cold start: the tap that launched the app.
    open(Notifications.getLastNotificationResponse());
    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: qk.alertsAll });
    });
    return () => {
      tapped.remove();
      received.remove();
    };
  }, []);
}
