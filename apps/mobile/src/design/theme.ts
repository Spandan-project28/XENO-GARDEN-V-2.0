import { Platform, type ViewStyle } from 'react-native';
import {
  darkPalette,
  layout,
  lightPalette,
  motion,
  radius,
  space,
  type as typeScale,
  type Palette,
} from './tokens';

export type ThemeName = 'light' | 'dark';
export type ThemePreference = 'system' | ThemeName;

export interface Theme {
  name: ThemeName;
  dark: boolean;
  colors: Palette;
  space: typeof space;
  radius: typeof radius;
  type: typeof typeScale;
  motion: typeof motion;
  layout: typeof layout;
  elevation: { card: ViewStyle; floating: ViewStyle; none: ViewStyle };
}

function elevation(p: Palette, dark: boolean): Theme['elevation'] {
  const shadow = (opacity: number, radiusPx: number, y: number, androidElevation: number): ViewStyle =>
    Platform.select<ViewStyle>({
      android: { elevation: androidElevation, shadowColor: p.shadow },
      default: {
        shadowColor: p.shadow,
        shadowOpacity: opacity,
        shadowRadius: radiusPx,
        shadowOffset: { width: 0, height: y },
      },
    })!;
  return {
    none: {},
    card: dark ? shadow(0.35, 18, 8, 2) : shadow(0.07, 16, 6, 2),
    floating: dark ? shadow(0.5, 28, 14, 10) : shadow(0.14, 26, 12, 10),
  };
}

function build(name: ThemeName): Theme {
  const dark = name === 'dark';
  const colors = dark ? darkPalette : lightPalette;
  return {
    name,
    dark,
    colors,
    space,
    radius,
    type: typeScale,
    motion,
    layout,
    elevation: elevation(colors, dark),
  };
}

export const themes: Record<ThemeName, Theme> = { light: build('light'), dark: build('dark') };

export function resolveTheme(pref: ThemePreference, system: 'light' | 'dark' | null | undefined): Theme {
  if (pref === 'system') return themes[system === 'light' ? 'light' : 'dark'];
  return themes[pref];
}
