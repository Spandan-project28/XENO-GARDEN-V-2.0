import { areaPath, niceDomain, smoothPath, toSegments } from './path';

describe('chart geometry', () => {
  it('scales values into the box, top = high', () => {
    const [seg] = toSegments([0, 50, 100], 200, 100, [0, 100], 0);
    expect(seg).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ]);
  });

  it('breaks lines at gaps (null readings)', () => {
    const segs = toSegments([10, 20, null, 30, null, null, 40, 50], 100, 50, [0, 100]);
    expect(segs.map((s) => s.length)).toEqual([2, 1, 2]);
  });

  it('builds valid SVG paths', () => {
    expect(smoothPath([{ x: 0, y: 0 }])).toBe('M0,0');
    const d = smoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]);
    expect(d).toMatch(/^M0\.00,10\.00 C5\.00,10\.00 5\.00,0\.00 10\.00,0\.00$/);
    expect(areaPath([{ x: 0, y: 1 }, { x: 5, y: 2 }], 20)).toMatch(/L5\.00,20 L0\.00,20 Z$/);
  });

  it('computes padded, clamped domains', () => {
    expect(niceDomain([40, 50])).toEqual([38, 52]);
    expect(niceDomain([1, 99], [0, 100])).toEqual([0, 100]);
    expect(niceDomain([null, null], [0, 100])).toEqual([0, 100]);
  });
});
