import { useMutation } from '@tanstack/react-query';
import type { LoginBody, UpgradeBody } from '@xeno/shared';
import { api } from '@/lib/api';
import { unregisterPushToken } from '@/lib/push';
import { sessionStore } from '@/lib/session';

export function useSignIn() {
  return useMutation({
    mutationFn: (body: LoginBody) => api.auth.login(body),
    onSuccess: (res) => sessionStore.establish(res),
  });
}

/** "Get started": a guest session, no sign-up (ADR-016). */
export function useStartGuest() {
  return useMutation({
    mutationFn: () => api.auth.guest(),
    onSuccess: (res) => sessionStore.establish(res),
  });
}

/** "Save your garden": attaches an email + password to the current guest account. */
export function useSaveGarden() {
  return useMutation({
    mutationFn: (body: UpgradeBody) => api.auth.upgrade(body),
    onSuccess: (user) => sessionStore.setUser(user),
  });
}

/** Revokes the session server-side (best effort) and wipes everything local. */
export async function signOut() {
  await unregisterPushToken(); // while still authenticated
  const refresh = await sessionStore.getRefreshToken();
  if (refresh) await api.auth.logout(refresh).catch(() => undefined);
  await sessionStore.clear();
}
