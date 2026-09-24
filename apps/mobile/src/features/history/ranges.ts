const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIVE_MIN = 5 * 60_000;

export const RANGES = [
  { key: '24h', label: '24H', ms: DAY },
  { key: '7d', label: '7D', ms: 7 * DAY },
  { key: '30d', label: '30D', ms: 30 * DAY },
  { key: '90d', label: '90D', ms: 90 * DAY },
] as const;
export type RangeKey = (typeof RANGES)[number]['key'];

/** Real time window ending now (aligned to 5 min so cache keys stay stable). */
export function computeRange(key: RangeKey, now: number) {
  const r = RANGES.find((x) => x.key === key) ?? RANGES[0];
  const to = Math.ceil(now / FIVE_MIN) * FIVE_MIN;
  return { from: to - r.ms, to, fromIso: new Date(to - r.ms).toISOString(), toIso: new Date(to).toISOString() };
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat(undefined, opts);
  return (t: number) => f.format(new Date(t));
};

/** Axis + tooltip formatters appropriate for the range. */
export function timeFormatters(key: RangeKey) {
  if (key === '24h') {
    return { axis: fmt({ hour: '2-digit', minute: '2-digit' }), tooltip: fmt({ weekday: 'short', hour: '2-digit', minute: '2-digit' }) };
  }
  if (key === '7d') {
    return { axis: fmt({ weekday: 'short', day: 'numeric' }), tooltip: fmt({ weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) };
  }
  return { axis: fmt({ day: 'numeric', month: 'short' }), tooltip: fmt({ weekday: 'short', day: 'numeric', month: 'short' }) };
}
