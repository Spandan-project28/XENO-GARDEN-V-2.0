/** Chart geometry helpers (pure, unit-tested). */

export interface Pt {
  x: number;
  y: number;
}

/** Scales values into a box. Nulls break the line into segments (gaps in data). */
export function toSegments(
  values: readonly (number | null)[],
  width: number,
  height: number,
  domain: [number, number],
  pad = 4,
): Pt[][] {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const n = values.length;
  const segs: Pt[][] = [];
  let cur: Pt[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (cur.length) segs.push(cur);
      cur = [];
      return;
    }
    const x = n <= 1 ? width / 2 : (i / (n - 1)) * width;
    const y = pad + (1 - (v - lo) / span) * (height - pad * 2);
    cur.push({ x, y });
  });
  if (cur.length) segs.push(cur);
  return segs;
}

/** Smooth path through points (monotone-ish cubic via midpoints). */
export function smoothPath(pts: readonly Pt[]): string {
  if (!pts.length) return '';
  const first = pts[0]!;
  if (pts.length === 1) return `M${first.x},${first.y}`;
  let d = `M${first.x.toFixed(2)},${first.y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const cx = (p0.x + p1.x) / 2;
    d += ` C${cx.toFixed(2)},${p0.y.toFixed(2)} ${cx.toFixed(2)},${p1.y.toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
  }
  return d;
}

/** Closes a line path down to the baseline for gradient fills. */
export function areaPath(pts: readonly Pt[], height: number): string {
  if (pts.length < 2) return '';
  const line = smoothPath(pts);
  return `${line} L${pts[pts.length - 1]!.x.toFixed(2)},${height} L${pts[0]!.x.toFixed(2)},${height} Z`;
}

/** Nice domain covering the data (with padding), clamped to [min,max] when given. */
export function niceDomain(values: readonly (number | null)[], clamp?: [number, number]): [number, number] {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (!v.length) return clamp ?? [0, 1];
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  const pad = Math.max((hi - lo) * 0.15, 2);
  lo -= pad;
  hi += pad;
  if (clamp) {
    lo = Math.max(clamp[0], lo);
    hi = Math.min(clamp[1], hi);
  }
  return [Math.floor(lo), Math.ceil(hi)];
}
