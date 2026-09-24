import { darkPalette, lightPalette, type Palette } from './tokens';
import { resolveTheme, themes } from './theme';

/** WCAG relative luminance contrast for #RRGGBB colours. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

describe('themes', () => {
  it('resolves preferences', () => {
    expect(resolveTheme('system', 'light').name).toBe('light');
    expect(resolveTheme('system', 'dark').name).toBe('dark');
    expect(resolveTheme('system', null).name).toBe('dark');
    expect(resolveTheme('light', 'dark').name).toBe('light');
  });

  it('both palettes define the same tokens', () => {
    expect(Object.keys(lightPalette).sort()).toEqual(Object.keys(darkPalette).sort());
    expect(themes.light.dark).toBe(false);
    expect(themes.dark.dark).toBe(true);
  });

  it.each([
    ['dark', darkPalette],
    ['light', lightPalette],
  ] as [string, Palette][])('%s palette meets WCAG AA for text', (_n, p) => {
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.text, p.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.textSecondary, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(3);
    for (const c of [p.accent, p.water, p.danger]) expect(contrast(c, p.surface)).toBeGreaterThanOrEqual(3);
  });
});
