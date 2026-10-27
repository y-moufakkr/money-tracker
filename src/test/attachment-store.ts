import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AttachmentStore } from '@/services/attachments';

/** Photo files under `root`, as the app keeps them under the documents directory. */
export function fsAttachmentStore(root: string): AttachmentStore & { root: string; exists(path: string): boolean } {
  const full = (p: string) => join(root, p);
  return {
    root,
    exists: (p) => existsSync(full(p)),
    write: async (p, bytes) => {
      mkdirSync(dirname(full(p)), { recursive: true });
      writeFileSync(full(p), bytes);
    },
    read: async (p) => (existsSync(full(p)) ? new Uint8Array(readFileSync(full(p))) : null),
    remove: async (p) => rmSync(full(p), { force: true }),
  };
}

/** In-memory photo files. `failWrites` makes the next writes throw (e.g. a full disk). */
export function memoryAttachmentStore() {
  const files = new Map<string, Uint8Array>();
  const state = { failWrites: false };
  const store: AttachmentStore = {
    write: async (p, bytes) => {
      if (state.failWrites) throw new Error('No space left on device');
      files.set(p, new Uint8Array(bytes));
    },
    read: async (p) => (files.has(p) ? new Uint8Array(files.get(p)!) : null),
    remove: async (p) => {
      files.delete(p);
    },
  };
  return { store, files, state };
}
