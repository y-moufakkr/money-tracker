import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

import { migrate } from '@/db/migrations';
import type { Db } from '@/db/types';
import type { BackupEngine, DatabaseCopy, DriveFile, DriveStore, DriveUpload } from '@/services/backup';
import { fsAttachmentStore } from './attachment-store';
import { wrapNodeDb } from './node-db';

type NodeCopy = DatabaseCopy & { raw: DatabaseSync };

/**
 * A file-backed WAL database plus the backup engine the app uses, implemented with node:sqlite:
 * VACUUM INTO a temp file, deserialize into memory, and the online backup API into the live file.
 */
export async function createFileTestDb(version?: number) {
  const dir = mkdtempSync(join(tmpdir(), 'money-tracker-'));
  const livePath = join(dir, 'money-tracker.db');
  const recoveryPath = join(dir, 'money-tracker-recovery.db');
  const raw = new DatabaseSync(livePath);
  raw.exec('PRAGMA journal_mode = WAL');
  // Keep writes in the WAL during tests, as on a phone between automatic checkpoints.
  raw.exec('PRAGMA wal_autocheckpoint = 0');
  const db: Db = wrapNodeDb(raw);
  await migrate(db, version);
  let n = 0;
  const attachments = fsAttachmentStore(join(dir, 'documents'));

  const open = async (bytes: Uint8Array): Promise<NodeCopy> => {
    const mem = new DatabaseSync(':memory:');
    mem.deserialize(bytes);
    return { raw: mem, db: wrapNodeDb(mem), close: async () => mem.close() };
  };

  const engine: BackupEngine = {
    live: db,
    snapshotPath: () => join(dir, `snapshot-${++n}.db`),
    readSnapshot: async (path) => {
      const bytes = new Uint8Array(readFileSync(path));
      rmSync(path);
      return bytes;
    },
    open,
    replaceLive: async (copy) => {
      await backup((copy as NodeCopy).raw, livePath);
    },
    saveRecovery: async (bytes) => {
      const copy = await open(bytes);
      try {
        rmSync(recoveryPath, { force: true });
        await backup(copy.raw, recoveryPath);
      } finally {
        await copy.close();
      }
      return new Uint8Array(readFileSync(recoveryPath));
    },
    loadRecovery: async () => (existsSync(recoveryPath) ? new Uint8Array(readFileSync(recoveryPath)) : null),
    attachments,
  };

  return {
    db,
    raw,
    engine,
    attachments,
    dir,
    livePath,
    recoveryPath,
    cleanup: () => {
      raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** In-memory Drive appDataFolder. `corrupt` alters what the next download returns. */
export function fakeDrive() {
  const files = new Map<string, DriveFile & { bytes: Uint8Array }>();
  let n = 0;
  const state = { corruptNextDownload: false, failRemove: false, removed: [] as string[] };
  const drive: DriveStore = {
    list: async () => [...files.values()].map(({ bytes, ...f }) => ({ ...f, size: String(bytes.length) })),
    upload: async (u: DriveUpload) => {
      const id = `file-${++n}`;
      files.set(id, { id, name: u.name, appProperties: u.appProperties, description: u.description, createdTime: u.appProperties.created_at, bytes: new Uint8Array(u.bytes) });
      return { id, name: u.name };
    },
    download: async (id) => {
      const f = files.get(id);
      if (!f) throw new Error('404');
      const bytes = new Uint8Array(f.bytes);
      if (state.corruptNextDownload) {
        state.corruptNextDownload = false;
        bytes[bytes.length >> 1] ^= 0xff;
      }
      return bytes;
    },
    remove: async (id) => {
      if (state.failRemove) throw new Error('network down');
      files.delete(id);
      state.removed.push(id);
    },
  };
  return { drive, files, state };
}
