import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '@/lib/api';

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
const normalizeType = (t: string | null | undefined): ImageType =>
  t === 'image/png' || t === 'image/webp' ? t : 'image/jpeg';

/** Opens the camera or library; returns null if the user cancels or denies access. */
export async function pickPlantPhoto(source: 'camera' | 'library') {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [4, 3] };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  return { uri: res.assets[0].uri, type: normalizeType(res.assets[0].mimeType) };
}

/**
 * Pre-signed upload: ask the API for a short-lived URL, PUT the bytes straight to it, then attach.
 * `fetchImpl` is injectable for tests.
 */
export async function uploadPlantPhoto(
  plantId: string,
  photo: { uri: string; type: ImageType },
  analyze: boolean,
  fetchImpl: typeof fetch = fetch,
) {
  const { photoId, upload } = await api.plants.photoUploadUrl(plantId, photo.type);
  const blob = await (await fetchImpl(photo.uri)).blob();
  const put = await fetchImpl(upload.url, { method: upload.method, headers: upload.headers, body: blob });
  if (!put.ok) throw new ApiError(put.status, 'UPLOAD_FAILED', 'The photo could not be uploaded. Please try again.');
  return api.plants.attachPhoto(plantId, photoId, analyze);
}
