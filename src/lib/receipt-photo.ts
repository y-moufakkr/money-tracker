import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { discardPhoto, readPhoto } from './attachment-store';
import { sha256Hex } from './hash';

/** Long edge of a stored receipt photo: sharp enough to read, small enough to back up. */
const MAX_EDGE = 2000;

/** A photo ready to attach: re-encoded as JPEG (upright, no EXIF location), still in the cache. */
export type PickedPhoto = { uri: string; bytes: Uint8Array; mime: 'image/jpeg'; sha256: string; width: number; height: number };

export class PhotoPermissionError extends Error {}

/** Takes a photo or picks one from the gallery. Null when cancelled. */
export async function pickReceiptPhoto(from: 'camera' | 'library'): Promise<PickedPhoto | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false };
  let result: ImagePicker.ImagePickerResult;
  if (from === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new PhotoPermissionError('Camera access is off. Allow it in the phone settings, or choose a photo from the gallery.');
    }
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  try {
    return await preparePhoto(asset.uri);
  } finally {
    discardPhoto(asset.uri);
  }
}

/** Resizes to at most MAX_EDGE on the long side and saves as JPEG. */
async function preparePhoto(uri: string): Promise<PickedPhoto> {
  const decoded = await ImageManipulator.manipulate(uri).renderAsync();
  const long = Math.max(decoded.width, decoded.height);
  const ctx = ImageManipulator.manipulate(uri);
  if (long > MAX_EDGE) {
    ctx.resize(decoded.width >= decoded.height ? { width: MAX_EDGE, height: null } : { width: null, height: MAX_EDGE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const bytes = await readPhoto(saved.uri);
  return { uri: saved.uri, bytes, mime: 'image/jpeg', sha256: await sha256Hex(bytes), width: saved.width, height: saved.height };
}
