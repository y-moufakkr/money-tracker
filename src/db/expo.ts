import type { SQLiteDatabase } from 'expo-sqlite';

import { createDb } from './core';
import type { Db } from './types';

export const DATABASE_NAME = 'money-tracker.db';

export function expoDb(db: SQLiteDatabase): Db {
  return createDb({
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes };
    },
    all: (sql, params) => db.getAllAsync(sql, params),
    first: (sql, params) => db.getFirstAsync(sql, params),
  });
}
