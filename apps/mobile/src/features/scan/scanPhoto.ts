import * as ImagePicker from 'expo-image-picker';
import type { ScanPublic } from '@xeno/shared';
import { api, ApiError } from '@/lib/api';

export type ScanImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export interface ScanPhoto {
  uri: string;
  type: ScanImageType;
}

/** The server accepts photos up to 5 MB. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type PickResult =
  | { kind: 'photo'; photo: ScanPhoto }
  | { kind: 'cancelled' }
  /** Permission refused; `settings` = only the system settings can grant it now. */
  | { kind: 'denied'; settings: boolean }
  | { kind: 'too_large' };

const normalizeType = (t: string | null | undefined): ScanImageType =>
  t === 'image/png' || t === 'image/webp' ? t : 'image/jpeg';

/** Opens the camera or the gallery. A square crop keeps one leaf in focus for the model. */
export async function pickScanPhoto(source: 'camera' | 'library'): Promise<PickResult> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { kind: 'denied', settings: !perm.canAskAgain };
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: true, aspect: [1, 1] };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return { kind: 'cancelled' };
  if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) return { kind: 'too_large' };
  return { kind: 'photo', photo: { uri: asset.uri, type: normalizeType(asset.mimeType) } };
}

export type ScanStep = 'uploading' | 'analyzing';

/**
 * Upload (pre-signed PUT straight to storage) → ask the server to analyse it.
 * `fetchImpl` is injectable for tests.
 */
export async function uploadAndScan(
  photo: ScanPhoto,
  deviceId: string | null,
  onStep: (s: ScanStep) => void = () => {},
  fetchImpl: typeof fetch = fetch,
): Promise<ScanPublic> {
  onStep('uploading');
  const { photoId, upload } = await api.scans.uploadUrl(photo.type);
  let put: Response;
  try {
    const blob = await (await fetchImpl(photo.uri)).blob();
    if (blob.size > MAX_PHOTO_BYTES) throw new ApiError(413, 'TOO_LARGE', 'This photo is too large. Crop it closer to the leaf and try again.');
    put = await fetchImpl(upload.url, { method: upload.method, headers: upload.headers, body: blob });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'NETWORK', 'The photo could not be uploaded. Check your connection and try again.');
  }
  if (!put.ok) throw new ApiError(put.status, 'UPLOAD_FAILED', 'The photo could not be uploaded. Please try again.');
  onStep('analyzing');
  return api.scans.create({ photoId, deviceId });
}
