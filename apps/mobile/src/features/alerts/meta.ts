import type { AlertSeverity, AlertType } from '@xeno/shared';
import {
  CloudSun,
  Droplet,
  HeartPulse,
  ThermometerSun,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import type { Palette } from '@/design';

export const ALERT_META: Record<AlertType, { title: string; icon: LucideIcon; tip: string }> = {
  LOW_MOISTURE: {
    title: 'Soil is dry',
    icon: Droplet,
    tip: 'Automatic watering hasn’t fixed it. Check the water tank, hose and pump.',
  },
  SENSOR_FAULT: {
    title: 'Sensor problem',
    icon: TriangleAlert,
    tip: 'Check that the soil sensor cable is plugged in and the probe is in the soil.',
  },
  DEVICE_OFFLINE: {
    title: 'Device offline',
    icon: WifiOff,
    tip: 'Check power and WiFi. The device keeps watering on its own while offline.',
  },
  PUMP_MAX_RUNTIME: {
    title: 'Pump safety stop',
    icon: CloudSun,
    tip: 'The pump ran its maximum time. An empty tank or blocked pipe is the usual cause.',
  },
  HIGH_TEMP: {
    title: 'Heat warning',
    icon: ThermometerSun,
    tip: 'Consider shade in the afternoon; plants lose water fast in heat.',
  },
  PLANT_HEALTH: {
    title: 'Plant health',
    icon: HeartPulse,
    tip: 'Open the plant health page for details.',
  },
};

export function severityColors(s: AlertSeverity, c: Palette) {
  if (s === 'critical') return { fg: c.danger, bg: c.dangerSoft };
  if (s === 'warning') return { fg: c.warning, bg: c.warningSoft };
  return { fg: c.info, bg: c.waterSoft };
}

/** "Today", "Yesterday", or a date — for section headers. */
export function dayLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).format(d);
}
