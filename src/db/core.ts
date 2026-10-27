import type { BindParams, Db } from './types';

/** Raw driver primitives; `createDb` adds write serialisation and transactions on top. */
export interface Driver {
  exec(sql: string): Promise<void>;
  run(sql: string, params: BindParams): Promise<{ changes: number }>;
  all<T>(sql: string, params: BindParams): Promise<T[]>;
  first<T>(sql: string, params: BindParams): Promise<T | null>;
}

/**
 * Wraps a single-connection driver. Writes and transactions are serialised
 * through one queue, so a transaction never interleaves with another write.
 * Reads run immediately (they may observe an in-flight transaction's rows,
 * which is harmless on a single-user device).
 */
export function createDb(driver: Driver): Db {
  let queue: Promise<unknown> = Promise.resolve();

  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn, fn);
    queue = result.catch(() => undefined);
    return result;
  }

  const reads = {
    all: <T>(sql: string, params: BindParams = []) => driver.all<T>(sql, params),
    first: <T>(sql: string, params: BindParams = []) => driver.first<T>(sql, params),
  };

  const inTx: Db = {
    ...reads,
    exec: (sql) => driver.exec(sql),
    run: (sql, params = []) => driver.run(sql, params),
    transaction: (fn) => fn(inTx),
    exclusive: (fn) => fn(inTx),
  };

  async function atomically<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    await driver.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(inTx);
      await driver.exec('COMMIT');
      return result;
    } catch (e) {
      await driver.exec('ROLLBACK').catch(() => undefined);
      throw e;
    }
  }

  /** Handed to `exclusive` callers: the queue is already held, transactions are still real. */
  const held: Db = {
    ...reads,
    exec: (sql) => driver.exec(sql),
    run: (sql, params = []) => driver.run(sql, params),
    transaction: atomically,
    exclusive: (fn) => fn(held),
  };

  return {
    ...reads,
    exec: (sql) => locked(() => driver.exec(sql)),
    run: (sql, params = []) => locked(() => driver.run(sql, params)),
    transaction: (fn) => locked(() => atomically(fn)),
    exclusive: (fn) => locked(() => fn(held)),
  };
}
