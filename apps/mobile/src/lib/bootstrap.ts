/**
 * App start-up session (simple mode, ADR-016): restore the saved session, or — on the very first
 * launch — silently create a guest account so the garden opens without any sign-up. Only if that
 * fails (no internet, server down) does the user see the welcome screen with a retry.
 */
import { api } from './api';
import { sessionStore } from './session';

export type BootResult = 'restored' | 'guest' | 'offline';

let inFlight: Promise<BootResult> | null = null;

export function bootSession(): Promise<BootResult> {
  inFlight ??= (async (): Promise<BootResult> => {
    if (await sessionStore.restore()) return 'restored';
    try {
      await sessionStore.establish(await api.auth.guest());
      return 'guest';
    } catch {
      sessionStore.markSignedOut();
      return 'offline';
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
