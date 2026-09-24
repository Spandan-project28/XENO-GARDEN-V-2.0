import { describe, expect, it } from 'vitest';
import { ConditionTracker } from '../../src/modules/alerts/engine.js';

const MIN = 60_000;

describe('ConditionTracker', () => {
  it('raises only after the condition holds for openAfter', () => {
    const t = new ConditionTracker();
    expect(t.update('k', true, 0, 10 * MIN, 2 * MIN)).toBeNull();
    expect(t.update('k', true, 9 * MIN, 10 * MIN, 2 * MIN)).toBeNull();
    expect(t.update('k', true, 10 * MIN, 10 * MIN, 2 * MIN)).toBe('raise');
  });

  it('never raises twice while the condition persists; touches at most once a minute', () => {
    const t = new ConditionTracker();
    t.update('k', true, 0, 0, 0);
    const actions = [];
    for (let s = 1; s <= 1000; s++) actions.push(t.update('k', true, s * 1000, 0, 2 * MIN));
    expect(actions.filter((a) => a === 'raise')).toHaveLength(0);
    expect(actions.filter((a) => a === 'touch')).toHaveLength(16); // 1000 s / 60 s
  });

  it('resets the open timer when the condition flaps', () => {
    const t = new ConditionTracker();
    t.update('k', true, 0, 10 * MIN, 2 * MIN);
    t.update('k', false, 5 * MIN, 10 * MIN, 2 * MIN);
    expect(t.update('k', true, 11 * MIN, 10 * MIN, 2 * MIN)).toBeNull();
    expect(t.update('k', true, 21 * MIN, 10 * MIN, 2 * MIN)).toBe('raise');
  });

  it('clears only after the condition stays false for clearAfter', () => {
    const t = new ConditionTracker();
    t.update('k', true, 0, 0, 2 * MIN);
    expect(t.update('k', false, MIN, 0, 2 * MIN)).toBeNull();
    expect(t.update('k', true, 2 * MIN, 0, 2 * MIN)).toBe('touch'); // brief recovery: still raised
    expect(t.update('k', false, 3 * MIN, 0, 2 * MIN)).toBeNull();
    expect(t.update('k', false, 5 * MIN, 0, 2 * MIN)).toBe('clear');
    expect(t.update('k', false, 6 * MIN, 0, 2 * MIN)).toBeNull();
  });

  it('keeps keys independent', () => {
    const t = new ConditionTracker();
    expect(t.update('a', true, 0, 0, 0)).toBe('raise');
    expect(t.update('b', true, 0, 0, 0)).toBe('raise');
    t.forget('a');
    expect(t.update('a', true, 1, 0, 0)).toBe('raise');
  });
});
