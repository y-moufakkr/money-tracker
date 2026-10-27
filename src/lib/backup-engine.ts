import {
  backupDatabaseAsync,
  defaultDatabaseDirectory,
  deleteDatabaseAsync,
  deserializeDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import { expoDb } from '@/db/expo';
import type { Db } from '@/db/types';
import type { BackupEngine, DatabaseCopy } from '@/services/backup';

export const RECOVERY_DATABASE_NAME = 'money-tracker-recovery.db';

/**
 * The backup engine on the phone (and in the web build), using only expo-sqlite:
 * - the snapshot file written by `VACUUM INTO` is read back by opening it and serializing it;
 * - copies are deserialized into memory, never written over the app's file;
 * - the live database is replaced with SQLite's online backup API into the open connection, so
 *   the swap is one transaction (no file juggling next to a WAL, no closed-connection window);
 * - the recovery copy is a second database file in the same directory.
 */
export function expoBackupEngine(sqlite: SQLiteDatabase, live: Db): BackupEngine {
  const handles = new WeakMap<DatabaseCopy, SQLiteDatabase>();
  let n = 0;

  const open = async (bytes: Uint8Array): Promise<DatabaseCopy> => {
    const mem = await deserializeDatabaseAsync(bytes);
    const copy: DatabaseCopy = { db: expoDb(mem), close: () => mem.closeAsync() };
    handles.set(copy, mem);
    return copy;
  };

  const readAndDelete = async (name: string, remove: boolean): Promise<Uint8Array | null> => {
    const db = await openDatabaseAsync(name, { useNewConnection: true });
    try {
      const tables = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sqlite_master');
      return tables && tables.n > 0 ? await db.serializeAsync() : null;
    } finally {
      await db.closeAsync();
      if (remove) await deleteDatabaseAsync(name);
    }
  };

  return {
    live,
    snapshotPath: () => `${String(defaultDatabaseDirectory).replace(/\/+$/, '')}/snapshot-${Date.now()}-${++n}.db`,
    readSnapshot: async (path) => {
      const bytes = await readAndDelete(path.slice(path.lastIndexOf('/') + 1), true);
      if (!bytes) throw new Error('The snapshot file is empty.');
      return bytes;
    },
    open,
    replaceLive: async (copy) => {
      const source = handles.get(copy);
      if (!source) throw new Error('Unknown database copy.');
      await backupDatabaseAsync({ sourceDatabase: source, destDatabase: sqlite });
    },
    saveRecovery: async (bytes) => {
      const mem = await deserializeDatabaseAsync(bytes);
      const dest = await openDatabaseAsync(RECOVERY_DATABASE_NAME, { useNewConnection: true });
      try {
        await backupDatabaseAsync({ sourceDatabase: mem, destDatabase: dest });
        return await dest.serializeAsync();
      } finally {
        await dest.closeAsync();
        await mem.closeAsync();
      }
    },
    loadRecovery: () => readAndDelete(RECOVERY_DATABASE_NAME, false),
  };
}
