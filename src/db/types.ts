export type BindValue = string | number | null;
export type BindParams = BindValue[] | Record<string, BindValue>;

/**
 * Minimal database interface shared by the app (expo-sqlite) and tests (node:sqlite).
 * All services depend on this, never on a concrete driver.
 */
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: BindParams): Promise<{ changes: number }>;
  all<T>(sql: string, params?: BindParams): Promise<T[]>;
  first<T>(sql: string, params?: BindParams): Promise<T | null>;
  /** Runs `fn` atomically. Nested calls reuse the outer transaction. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /**
   * Runs `fn` while holding the write queue, outside any transaction (checkpoint, VACUUM INTO,
   * restore). `fn` must use the `Db` it receives: the outer one would wait for the queue it holds.
   */
  exclusive<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}
