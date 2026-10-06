import type { ScanPublic, ScanSeverity } from '@xeno/shared';
import { AlertTriangle, CheckCircle2, HelpCircle, ImageOff, ShieldAlert, type LucideIcon } from 'lucide-react-native';
import type { Theme } from '@/design';

export interface StatusVisual {
  label: string;
  color: string;
  soft: string;
  icon: LucideIcon;
}

/** One colour language for scan results everywhere (result, list, dashboard). */
export function statusVisual(scan: Pick<ScanPublic, 'status' | 'severity'>, t: Theme): StatusVisual {
  switch (scan.status) {
    case 'healthy':
      return { label: 'Healthy', color: t.colors.accent, soft: t.colors.accentSoft, icon: CheckCircle2 };
    case 'disease':
      return scan.severity === 'high'
        ? { label: 'Act now', color: t.colors.danger, soft: t.colors.dangerSoft, icon: ShieldAlert }
        : { label: 'Needs care', color: t.colors.warning, soft: t.colors.warningSoft, icon: AlertTriangle };
    case 'uncertain':
      return { label: 'Not sure', color: t.colors.info, soft: t.colors.waterSoft, icon: HelpCircle };
    default:
      return { label: 'No leaf', color: t.colors.textSecondary, soft: t.colors.surfaceAlt, icon: ImageOff };
  }
}

export const severityLabel: Record<ScanSeverity, string> = {
  none: '',
  low: 'Mild',
  medium: 'Moderate',
  high: 'Serious',
};

/** "Very sure · 94 %" */
export function confidenceText(c: number | null): string {
  if (c === null) return 'No score from the model';
  const pct = `${Math.round(c * 100)} %`;
  return c >= 0.85 ? `Very sure · ${pct}` : c >= 0.65 ? `Fairly sure · ${pct}` : `Unsure · ${pct}`;
}

/** "Tomato · Xeno 1" */
export const scanSubtitle = (s: Pick<ScanPublic, 'crop' | 'deviceName'>) => [s.crop, s.deviceName].filter(Boolean).join(' · ');
