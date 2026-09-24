import type { RtTelemetry } from '@xeno/shared';
import { create } from 'zustand';

const MAX_POINTS = 240;

interface LiveState {
  byDevice: Record<string, RtTelemetry[]>;
  push: (e: RtTelemetry) => void;
  clear: () => void;
}

/** Recent live readings per device (ring buffer) for sparklines and "just now" charts. */
export const useLiveTelemetry = create<LiveState>((set) => ({
  byDevice: {},
  push: (e) =>
    set((s) => {
      const prev = s.byDevice[e.deviceId] ?? [];
      const next = prev.length >= MAX_POINTS ? [...prev.slice(prev.length - MAX_POINTS + 1), e] : [...prev, e];
      return { byDevice: { ...s.byDevice, [e.deviceId]: next } };
    }),
  clear: () => set({ byDevice: {} }),
}));
