import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ThemePreference } from '@/design/theme';

export type TemperatureUnit = 'c' | 'f';

interface PrefsState {
  theme: ThemePreference;
  units: TemperatureUnit;
  /** Device shown first on Home / preselected in History. */
  lastDeviceId: string | null;
  hydrated: boolean;
  setTheme: (t: ThemePreference) => void;
  setUnits: (u: TemperatureUnit) => void;
  setLastDeviceId: (id: string | null) => void;
}

/** Per-install UI preferences (not account data). Persisted to AsyncStorage. */
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      units: 'c',
      lastDeviceId: null,
      hydrated: false,
      setTheme: (theme) => set({ theme }),
      setUnits: (units) => set({ units }),
      setLastDeviceId: (lastDeviceId) => set({ lastDeviceId }),
    }),
    {
      name: 'xg-prefs',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ theme, units, lastDeviceId }) => ({ theme, units, lastDeviceId }),
      onRehydrateStorage: () => () => usePrefs.setState({ hydrated: true }),
    },
  ),
);
