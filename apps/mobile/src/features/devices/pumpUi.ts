import type { DevicePublic, PumpAction } from '@xeno/shared';

export interface PendingCommand {
  action: PumpAction;
  /** desired.version that carries the command; confirmed once the device has applied it. */
  version: number;
  since: number;
}

export type PumpUiState = 'idle' | 'running' | 'starting' | 'stopping';

/** How long we wait for the device to confirm before telling the user. */
export const CONFIRM_TIMEOUT_MS = 20_000;

/**
 * Derives what the pump button should show from the device's *reported* state (truth) and the
 * command the user just sent (intent). The UI never pretends a command worked until the device
 * says so.
 */
export function derivePumpUi(
  d: DevicePublic,
  pending: PendingCommand | null,
  now: number,
): { state: PumpUiState; remainingSec: number | null; unconfirmed: boolean } {
  const r = d.reported;
  const running = r?.pump ?? false;
  const elapsed = r ? Math.max(0, (now - Date.parse(r.at)) / 1000) : 0;
  const remainingSec =
    running && r?.manualRemainingSec !== null && r?.manualRemainingSec !== undefined
      ? Math.max(0, Math.round(r.manualRemainingSec - elapsed))
      : null;

  if (pending) {
    const confirmed = (r?.appliedVersion ?? 0) >= pending.version;
    if (!confirmed && now - pending.since <= CONFIRM_TIMEOUT_MS) {
      return { state: pending.action === 'ON' ? 'starting' : 'stopping', remainingSec, unconfirmed: false };
    }
    // Confirmed — or the device never answered: show the truth and flag it.
    return { state: running ? 'running' : 'idle', remainingSec, unconfirmed: !confirmed };
  }
  return { state: running ? 'running' : 'idle', remainingSec, unconfirmed: false };
}

export const DURATIONS_MIN = [5, 10, 15, 30] as const;

/** Durations the user can choose, never longer than the device's safety limit. */
export function allowedDurations(maxPumpRunSec: number): number[] {
  const opts = DURATIONS_MIN.map((m) => m * 60).filter((s) => s <= maxPumpRunSec);
  return opts.length ? opts : [maxPumpRunSec];
}
