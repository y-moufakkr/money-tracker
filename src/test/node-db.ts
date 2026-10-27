import { DatabaseSync } from 'node:sqlite';

import { createDb } from '@/db/core';
import { migrate } from '@/db/migrations';
import type { BindParams, Db } from '@/db/types';

function bind(params: BindParams): unknown[] {
  if (Array.isArray(params)) return params;
  return [params];
}

/** Wraps a node:sqlite connection in the app's `Db` interface. */
export function wrapNodeDb(raw: DatabaseSync): Db {
  return createDb({
    exec: async (sql) => {
      raw.exec(sql);
    },
    run: async (sql, params) => {
      const r = raw.prepare(sql).run(...(bind(params) as []));
      return { changes: Number(r.changes) };
    },
    all: async <T>(sql: string, params: BindParams) =>
      raw.prepare(sql).all(...(bind(params) as [])).map((r) => ({ ...r }) as T),
    first: async <T>(sql: string, params: BindParams) => {
      const r = raw.prepare(sql).get(...(bind(params) as []));
      return r ? ({ ...r } as T) : null;
    },
  });
}

/** In-memory database using Node's built-in SQLite, migrated to the latest schema (or to `version`). */
export async function createTestDb(version?: number): Promise<Db> {
  const db = wrapNodeDb(new DatabaseSync(':memory:'));
  await migrate(db, version);
  return db;
}
