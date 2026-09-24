import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { usePrefs } from '@/lib/prefs';
import { resolveTheme, themes, type Theme } from './theme';

const ThemeContext = createContext<Theme>(themes.dark);

export function ThemeProvider({ children, override }: { children: ReactNode; override?: Theme }) {
  const pref = usePrefs((s) => s.theme);
  const system = useColorScheme();
  const theme = override ?? resolveTheme(pref, system === 'unspecified' ? null : system);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

type NamedStyles<T> = { [P in keyof T]: StyleSheet.NamedStyles<T>[P] };

/**
 * Theme-aware styles, memoised per theme:
 *   const useS = makeStyles((t) => ({ card: { backgroundColor: t.colors.surface } }));
 *   const s = useS();
 */
export function makeStyles<T extends NamedStyles<T>>(factory: (t: Theme) => T) {
  const cache = new WeakMap<Theme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => {
      const hit = cache.get(theme);
      if (hit) return hit;
      const created = StyleSheet.create(factory(theme)) as T;
      cache.set(theme, created);
      return created;
    }, [theme]);
  };
}
