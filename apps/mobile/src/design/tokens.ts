/**
 * Design tokens — the ONLY place raw colours, sizes, fonts and motion values live.
 * Feature code reads everything through `useTheme()` / `useStyles()`. To restyle the whole app,
 * edit this file (or add a new palette); nothing else should need to change.
 */

export interface Palette {
  bg: string;
  bgGradient: readonly [string, string, string];
  surface: string;
  surfaceAlt: string;
  surfaceGlass: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  water: string;
  waterSoft: string;
  sun: string;
  sunSoft: string;
  humidity: string;
  humiditySoft: string;
  rain: string;
  rainSoft: string;
  success: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  skeleton: string;
  tabBar: string;
  overlay: string;
  shadow: string;
}

/** "Night garden" — deep green-black, luminous accents. */
export const darkPalette: Palette = {
  bg: '#08110D',
  bgGradient: ['#0C1C14', '#08110D', '#050B08'],
  surface: '#0F1C16',
  surfaceAlt: '#15261E',
  surfaceGlass: 'rgba(20, 36, 29, 0.72)',
  border: 'rgba(214, 255, 232, 0.08)',
  borderStrong: 'rgba(214, 255, 232, 0.16)',
  text: '#ECF5EF',
  textSecondary: '#A7B8AF',
  textTertiary: '#6E8278',
  accent: '#3DDC84',
  accentSoft: 'rgba(61, 220, 132, 0.14)',
  onAccent: '#03130A',
  water: '#4DB6FF',
  waterSoft: 'rgba(77, 182, 255, 0.14)',
  sun: '#FFB74D',
  sunSoft: 'rgba(255, 183, 77, 0.14)',
  humidity: '#6EE7E0',
  humiditySoft: 'rgba(110, 231, 224, 0.14)',
  rain: '#9AA8FF',
  rainSoft: 'rgba(154, 168, 255, 0.14)',
  success: '#3DDC84',
  warning: '#FFC857',
  warningSoft: 'rgba(255, 200, 87, 0.14)',
  danger: '#FF6B6B',
  dangerSoft: 'rgba(255, 107, 107, 0.14)',
  info: '#7AA7FF',
  skeleton: 'rgba(255, 255, 255, 0.06)',
  tabBar: 'rgba(11, 21, 16, 0.88)',
  overlay: 'rgba(0, 0, 0, 0.55)',
  shadow: '#000000',
};

/** "Morning garden" — warm off-white, fresh greens. */
export const lightPalette: Palette = {
  bg: '#F3F6F1',
  bgGradient: ['#F8FBF5', '#F1F5EF', '#E8EFE6'],
  surface: '#FFFFFF',
  surfaceAlt: '#F3F7F2',
  surfaceGlass: 'rgba(255, 255, 255, 0.80)',
  border: 'rgba(16, 40, 28, 0.08)',
  borderStrong: 'rgba(16, 40, 28, 0.15)',
  text: '#0D1A13',
  textSecondary: '#4E6157',
  textTertiary: '#8A9A91',
  accent: '#149453',
  accentSoft: 'rgba(20, 148, 83, 0.11)',
  onAccent: '#FFFFFF',
  water: '#1B7FD1',
  waterSoft: 'rgba(27, 127, 209, 0.11)',
  sun: '#DB8400',
  sunSoft: 'rgba(219, 132, 0, 0.11)',
  humidity: '#0E9C9C',
  humiditySoft: 'rgba(14, 156, 156, 0.11)',
  rain: '#4F5FD6',
  rainSoft: 'rgba(79, 95, 214, 0.11)',
  success: '#149453',
  warning: '#C98300',
  warningSoft: 'rgba(201, 131, 0, 0.12)',
  danger: '#D64545',
  dangerSoft: 'rgba(214, 69, 69, 0.11)',
  info: '#3563E9',
  skeleton: 'rgba(13, 26, 19, 0.07)',
  tabBar: 'rgba(255, 255, 255, 0.92)',
  overlay: 'rgba(8, 17, 13, 0.4)',
  shadow: '#0D1A13',
};

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  /** Horizontal screen padding. */
  gutter: 20,
} as const;

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

/** Font family names as registered with expo-font in the root layout. */
export const fonts = {
  displayMedium: 'SpaceGrotesk_500Medium',
  displaySemiBold: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  body: 'Manrope_500Medium',
  bodyRegular: 'Manrope_400Regular',
  bodySemiBold: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
} as const;

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase' | 'none';
}

export const type = {
  hero: { fontFamily: fonts.displayBold, fontSize: 56, lineHeight: 60, letterSpacing: -2 },
  display: { fontFamily: fonts.displayBold, fontSize: 40, lineHeight: 44, letterSpacing: -1.2 },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  heading: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  subheading: { fontFamily: fonts.bodySemiBold, fontSize: 17, lineHeight: 23 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 23 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, lineHeight: 19 },
  caption: { fontFamily: fonts.bodySemiBold, fontSize: 13, lineHeight: 17 },
  overline: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  metric: { fontFamily: fonts.displaySemiBold, fontSize: 24, lineHeight: 28, letterSpacing: -0.5 },
} as const satisfies Record<string, TypeStyle>;
export type TypeVariant = keyof typeof type;

export const motion = {
  spring: { damping: 18, stiffness: 180, mass: 1 },
  snappy: { damping: 22, stiffness: 320, mass: 0.9 },
  gentle: { damping: 24, stiffness: 90, mass: 1 },
  duration: { fast: 150, base: 250, slow: 450, gauge: 900 },
  pressScale: 0.97,
} as const;

export const layout = {
  minTouch: 44,
  tabBarHeight: 64,
  maxContentWidth: 560,
} as const;
