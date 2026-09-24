import { makeDevice, reported } from '@/test/fixtures';
import { allowedDurations, CONFIRM_TIMEOUT_MS, derivePumpUi } from './pumpUi';

const at = '2026-01-01T10:00:00.000Z';
const T = Date.parse(at);

describe('derivePumpUi', () => {
  it('reflects the reported state when nothing is pending', () => {
    expect(derivePumpUi(makeDevice({ reported: reported({ pump: false, at }) }), null, T).state).toBe('idle');
    expect(derivePumpUi(makeDevice({ reported: reported({ pump: true, at }) }), null, T).state).toBe('running');
  });

  it('shows starting until the device applies the command version', () => {
    const pending = { action: 'ON' as const, version: 2, since: T };
    const before = makeDevice({ reported: reported({ appliedVersion: 1, pump: false, at }) });
    expect(derivePumpUi(before, pending, T + 1000)).toMatchObject({ state: 'starting', unconfirmed: false });
    const after = makeDevice({
      reported: reported({ appliedVersion: 2, pump: true, pumpReason: 'manual', manualRemainingSec: 600, at }),
    });
    expect(derivePumpUi(after, pending, T + 1000)).toMatchObject({ state: 'running', unconfirmed: false });
  });

  it('counts down the remaining manual time since the report', () => {
    const d = makeDevice({ reported: reported({ appliedVersion: 2, pump: true, manualRemainingSec: 600, at }) });
    expect(derivePumpUi(d, null, T + 65_000).remainingSec).toBe(535);
  });

  it('stays confirmed after the run ends on its own', () => {
    const pending = { action: 'ON' as const, version: 2, since: T };
    const later = makeDevice({ reported: reported({ appliedVersion: 3, pump: false, at }) });
    expect(derivePumpUi(later, pending, T + 700_000)).toMatchObject({ state: 'idle', unconfirmed: false });
  });

  it('flags commands the device never confirmed', () => {
    const pending = { action: 'OFF' as const, version: 5, since: T };
    const d = makeDevice({ reported: reported({ appliedVersion: 4, pump: true, at }) });
    expect(derivePumpUi(d, pending, T + 1000).state).toBe('stopping');
    expect(derivePumpUi(d, pending, T + CONFIRM_TIMEOUT_MS + 1)).toMatchObject({ state: 'running', unconfirmed: true });
  });
});

describe('allowedDurations', () => {
  it('never exceeds the device safety limit', () => {
    expect(allowedDurations(600)).toEqual([300, 600]);
    expect(allowedDurations(3600)).toEqual([300, 600, 900, 1800]);
    expect(allowedDurations(120)).toEqual([120]);
  });
});
