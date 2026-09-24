/**
 * Feature flags. Flip a default to ship a feature dark, or override per build with
 * EXPO_PUBLIC_FLAG_<NAME>=true|false. (Expo inlines EXPO_PUBLIC_* only when referenced
 * statically, so each flag reads its variable explicitly.)
 */
const parse = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined || v === '' ? fallback : v === 'true' || v === '1';

export const flags = {
  /** Plant health insights screen (rule-based today, ML later). */
  plantHealth: parse(process.env.EXPO_PUBLIC_FLAG_PLANT_HEALTH, true),
  /** Photo upload for ML plant-health analysis. */
  photoUpload: parse(process.env.EXPO_PUBLIC_FLAG_PHOTO_UPLOAD, false),
  /** Simulated Bluetooth device for onboarding demos without hardware. */
  demoProvisioning: parse(process.env.EXPO_PUBLIC_FLAG_DEMO_PROVISIONING, __DEV__),
} as const;
