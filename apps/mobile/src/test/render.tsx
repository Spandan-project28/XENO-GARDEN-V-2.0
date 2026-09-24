import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, themes, type Theme } from '@/design';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function Providers({ children, theme = themes.dark }: { children: ReactNode; theme?: Theme }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider override={theme}>{children}</ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Renders inside the same providers the app uses (theme, safe area, gestures). Async (RNTL 14). */
export function renderWithProviders(ui: ReactElement, opts: RenderOptions & { theme?: Theme } = {}) {
  const { theme, ...rest } = opts;
  return render(ui, { wrapper: ({ children }) => <Providers theme={theme}>{children}</Providers>, ...rest });
}
