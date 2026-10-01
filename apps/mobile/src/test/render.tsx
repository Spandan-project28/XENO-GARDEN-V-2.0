import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, themes, type Theme } from '@/design';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export const testQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });

export function Providers({
  children,
  theme = themes.dark,
  client,
}: {
  children: ReactNode;
  theme?: Theme;
  client?: QueryClient;
}) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={metrics}>
        <QueryClientProvider client={client ?? testQueryClient()}>
          <ThemeProvider override={theme}>{children}</ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Renders inside the same providers the app uses (theme, safe area, gestures). Async (RNTL 14). */
export function renderWithProviders(
  ui: ReactElement,
  opts: RenderOptions & { theme?: Theme; client?: QueryClient } = {},
) {
  const { theme, client, ...rest } = opts;
  return render(ui, {
    wrapper: ({ children }) => (
      <Providers theme={theme} client={client}>
        {children}
      </Providers>
    ),
    ...rest,
  });
}
