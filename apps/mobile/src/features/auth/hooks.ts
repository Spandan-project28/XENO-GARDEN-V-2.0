import { useMutation } from '@tanstack/react-query';
import type { LoginBody, RegisterBody } from '@xeno/shared';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/session';

export function useSignIn() {
  return useMutation({
    mutationFn: (body: LoginBody) => api.auth.login(body),
    onSuccess: (res) => sessionStore.establish(res),
  });
}

export function useSignUp() {
  return useMutation({
    mutationFn: (body: RegisterBody) => api.auth.register(body),
    onSuccess: (res) => sessionStore.establish(res),
  });
}

/** Revokes the session server-side (best effort) and wipes everything local. */
export async function signOut() {
  const refresh = await sessionStore.getRefreshToken();
  if (refresh) await api.auth.logout(refresh).catch(() => undefined);
  await sessionStore.clear();
}
