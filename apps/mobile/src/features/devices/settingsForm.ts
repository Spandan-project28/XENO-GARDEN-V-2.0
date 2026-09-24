import { deviceSettings, type DeviceSettings, type DeviceSettingsPatch } from '@xeno/shared';

/** Only the fields that changed — the backend merges and re-validates. */
export function diffSettings(base: DeviceSettings, draft: DeviceSettings): DeviceSettingsPatch {
  const patch: DeviceSettingsPatch = {};
  for (const k of Object.keys(draft) as (keyof DeviceSettings)[]) {
    if (draft[k] !== base[k]) (patch as Record<string, unknown>)[k] = draft[k];
  }
  return patch;
}

export function validateSettings(draft: DeviceSettings): string | null {
  const r = deviceSettings.safeParse(draft);
  return r.success ? null : (r.error.issues[0]?.message ?? 'Invalid settings');
}

export function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} h ${rm} min` : `${h} h`;
}
