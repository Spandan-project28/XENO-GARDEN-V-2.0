import { countdown, durationText, formatTemp, greeting, moistureState, pumpReasonText, relativeTime } from './format';

describe('format', () => {
  it('temperatures in both units', () => {
    expect(formatTemp(24.26, 'c')).toEqual({ value: '24.3', unit: '°C' });
    expect(formatTemp(25, 'f')).toEqual({ value: '77', unit: '°F' });
    expect(formatTemp(null, 'c')).toEqual({ value: '—', unit: '' });
  });
  it('relative times', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(relativeTime('2026-01-01T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-01-01T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-01-01T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2025-12-30T12:00:00Z', now)).toBe('2 d ago');
    expect(relativeTime(null, now)).toBe('never');
  });
  it('durations and countdowns', () => {
    expect(countdown(605)).toBe('10:05');
    expect(durationText(42)).toBe('42 s');
    expect(durationText(600)).toBe('10 min');
    expect(durationText(3900)).toBe('1 h 5 min');
  });
  it('moisture state and reasons', () => {
    expect(moistureState(null, 30, 45)).toBe('unknown');
    expect(moistureState(20, 30, 45)).toBe('dry');
    expect(moistureState(40, 30, 45)).toBe('ok');
    expect(moistureState(70, 30, 45)).toBe('wet');
    expect(pumpReasonText('rain')).toMatch(/raining/);
    expect(pumpReasonText(null)).toMatch(/Waiting/);
  });
  it('greets by time of day', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Good morning');
    expect(greeting(new Date(2026, 0, 1, 20))).toBe('Good evening');
  });
});
