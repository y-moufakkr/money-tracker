import { LedgerError, type Db } from '@/db/types';
import { isValidISODate, todayISO } from '@/domain/dates';
import { BASE_CURRENCY } from '@/domain/money';
import { newId, nowISO } from '@/lib/id';

/** Latest user-entered rate per currency on or before `asOf`. */
export async function latestRates(db: Db, asOf: string = todayISO()): Promise<Map<string, number>> {
  const rows = await db.all<{ currency: string; rate_micros: number }>(
    `SELECT f.currency, f.rate_micros FROM fx_rates f
     WHERE f.as_of <= ? AND NOT EXISTS (
       SELECT 1 FROM fx_rates g WHERE g.currency = f.currency AND g.as_of <= ?
         AND (g.as_of > f.as_of OR (g.as_of = f.as_of AND g.created_at > f.created_at))
     )`,
    [asOf, asOf],
  );
  return new Map(rows.map((r) => [r.currency, r.rate_micros]));
}

export async function listRates(db: Db): Promise<{ id: string; currency: string; rateMicros: number; asOf: string }[]> {
  const rows = await db.all<{ id: string; currency: string; rate_micros: number; as_of: string }>(
    'SELECT id, currency, rate_micros, as_of FROM fx_rates ORDER BY as_of DESC, created_at DESC',
  );
  return rows.map((r) => ({ id: r.id, currency: r.currency, rateMicros: r.rate_micros, asOf: r.as_of }));
}

export async function setRate(db: Db, currency: string, rateMicros: number, asOf: string): Promise<void> {
  if (currency === BASE_CURRENCY) throw new LedgerError(`${BASE_CURRENCY} is the base currency.`);
  if (!Number.isInteger(rateMicros) || rateMicros <= 0) throw new LedgerError('Exchange rate must be positive.');
  if (!isValidISODate(asOf)) throw new LedgerError('Rate date is invalid.');
  await db.run('INSERT INTO fx_rates (id, currency, rate_micros, as_of, created_at) VALUES (?, ?, ?, ?, ?)', [
    newId(),
    currency,
    rateMicros,
    asOf,
    nowISO(),
  ]);
}
