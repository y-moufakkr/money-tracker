import type { AttachmentStore } from '@/services/attachments';

/**
 * Web build (smoke tests only): photos live in the origin-private file system (OPFS), under the
 * same relative paths as on the phone.
 */
async function locate(path: string, create: boolean) {
  let dir = await navigator.storage.getDirectory();
  const parts = path.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, name: parts[parts.length - 1] };
}

async function readFile(path: string): Promise<File | null> {
  try {
    const { dir, name } = await locate(path, false);
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

export const attachmentStore: AttachmentStore = {
  write: async (path, bytes) => {
    const { dir, name } = await locate(path, true);
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(bytes as Uint8Array<ArrayBuffer>);
    await w.close();
  },
  read: async (path) => {
    const f = await readFile(path);
    return f ? new Uint8Array(await f.arrayBuffer()) : null;
  },
  remove: async (path) => {
    try {
      const { dir, name } = await locate(path, false);
      await dir.removeEntry(name);
    } catch {
      // Already gone.
    }
  },
};

const urls = new Map<string, string>();

export async function attachmentUri(path: string): Promise<string | null> {
  const cached = urls.get(path);
  if (cached) return cached;
  const f = await readFile(path);
  if (!f) return null;
  const url = URL.createObjectURL(f);
  urls.set(path, url);
  return url;
}

export async function readPhoto(uri: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(uri)).arrayBuffer());
}

export function discardPhoto(uri: string) {
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}
