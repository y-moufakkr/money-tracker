import { File, Paths } from 'expo-file-system';

import type { AttachmentStore } from '@/services/attachments';

/** Receipt photos under the documents directory; `path` is relative (`attachments/<id>.jpg`). */
const fileAt = (path: string) => new File(Paths.document, ...path.split('/'));

export const attachmentStore: AttachmentStore = {
  write: async (path, bytes) => {
    const f = fileAt(path);
    f.parentDirectory.create({ intermediates: true, idempotent: true });
    f.create({ overwrite: true });
    await f.write(bytes);
  },
  read: async (path) => {
    const f = fileAt(path);
    return f.exists ? await f.bytes() : null;
  },
  remove: async (path) => {
    const f = fileAt(path);
    if (f.exists) f.delete();
  },
};

/** A URI that `expo-image` can show. */
export async function attachmentUri(path: string): Promise<string | null> {
  const f = fileAt(path);
  return f.exists ? f.uri : null;
}

/** Bytes of a photo just taken or picked (a file in the cache). */
export async function readPhoto(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}

/** Deletes a temporary photo. Only files in the cache are touched. */
export function discardPhoto(uri: string) {
  if (!uri.startsWith(Paths.cache.uri)) return;
  const f = new File(uri);
  if (f.exists) f.delete();
}
