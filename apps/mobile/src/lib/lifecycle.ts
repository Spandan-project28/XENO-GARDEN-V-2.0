import { useLiveTelemetry } from './liveTelemetry';
import { queryClient, queryPersister } from './queryClient';
import { realtime } from './realtime';
import { onSignOut } from './session';

let wired = false;

/** Everything that must be wiped when the user signs out (or the session is revoked). */
export function wireSignOutCleanup() {
  if (wired) return;
  wired = true;
  onSignOut(() => {
    realtime.stop();
    queryClient.clear();
    void queryPersister.removeClient();
    useLiveTelemetry.getState().clear();
  });
}
