/**
 * Reconciliation compares the app's calculated balance with the real one.
 * A difference is never absorbed silently: it either stays open for
 * investigation or becomes an explicit, auditable adjustment transaction.
 */
import { LedgerError, type Db } from '@/db/types';
import { isValidISODate, todayISO } from '@/domain/dates';
import type { Reconciliation, ReconciliationStatus } from '@/domain/types';
import { newId, nowISO } from '@/lib/id';
import { requireAccount } from './accounts';
import { accountBalance } from './balances';

type Row = {
  id: string;
  account_id: string;
  date: string;
  statement_balance_minor: number;
  calculated_balance_minor: number;
  difference_minor: number;
  status: ReconciliationStatus;
  adjustment_transaction_id: string | null;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
};

const map = (r: Row): Reconciliation => ({
  id: r.id,
  accountId: r.account_id,
  date: r.date,
  statementBalanceMinor: r.statement_balance_minor,
  calculatedBalanceMinor: r.calculated_balance_minor,
  differenceMinor: r.difference_minor,
  status: r.status,
  adjustmentTransactionId: r.adjustment_transaction_id,
  note: r.note,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

export async function listReconciliations(db: Db, accountId: string): Promise<Reconciliation[]> {
  const rows = await db.all<Row>(
    'SELECT * FROM reconciliations WHERE account_id = ? ORDER BY date DESC, created_at DESC',
    [accountId],
  );
  return rows.map(map);
}

export async function getReconciliation(db: Db, id: string): Promise<Reconciliation | null> {
  const r = await db.first<Row>('SELECT * FROM reconciliations WHERE id = ?', [id]);
  return r ? map(r) : null;
}

async function insertAdjustment(tx: Db, accountId: string, currency: string, date: string, diff: number, note: string) {
  const id = newId();
  const ts = nowISO();
  await tx.run(
    `INSERT INTO transactions (id, kind, date, amount_minor, currency, note, created_at, updated_at)
     VALUES (?, 'adjustment', ?, ?, ?, ?, ?, ?)`,
    [id, date, Math.abs(diff), currency, note, ts, ts],
  );
  await tx.run(
    `INSERT INTO postings (id, transaction_id, account_id, amount_minor, role, created_at)
     VALUES (?, ?, ?, ?, 'main', ?)`,
    [newId(), id, accountId, diff, ts],
  );
  return id;
}

export type ReconcileInput = {
  accountId: string;
  date: string;
  statementBalanceMinor: number;
  /** 'adjust' records the difference as an adjustment; 'investigate' leaves it open. */
  action: 'adjust' | 'investigate';
  note?: string | null;
};

export async function reconcileAccount(db: Db, input: ReconcileInput): Promise<Reconciliation> {
  if (!isValidISODate(input.date) || input.date > todayISO()) throw new LedgerError('Choose a valid date, not in the future.');
  if (!Number.isSafeInteger(input.statementBalanceMinor)) throw new LedgerError('Actual balance is invalid.');

  const id = await db.transaction(async (tx) => {
    const account = await requireAccount(tx, input.accountId);
    if (input.date < account.openingDate) throw new LedgerError('The date is before this location was opened.');
    const calculated = await accountBalance(tx, account.id, input.date);
    const diff = input.statementBalanceMinor - calculated;
    const note = input.note?.trim() || null;
    const ts = nowISO();

    let status: ReconciliationStatus = 'matched';
    let adjustmentId: string | null = null;
    if (diff !== 0 && input.action === 'adjust') {
      adjustmentId = await insertAdjustment(
        tx,
        account.id,
        account.currency,
        input.date,
        diff,
        note ?? 'Balance adjustment from reconciliation',
      );
      status = 'adjusted';
    } else if (diff !== 0) {
      status = 'open';
    }

    const recId = newId();
    await tx.run(
      `INSERT INTO reconciliations (id, account_id, date, statement_balance_minor, calculated_balance_minor,
         difference_minor, status, adjustment_transaction_id, note, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recId,
        account.id,
        input.date,
        input.statementBalanceMinor,
        calculated,
        diff,
        status,
        adjustmentId,
        note,
        ts,
        status === 'open' ? null : ts,
      ],
    );
    return recId;
  });
  return (await getReconciliation(db, id))!;
}

/**
 * Re-checks an open reconciliation against the current ledger (e.g. after the
 * missing transaction was recorded). If a difference remains and `adjust` is
 * true, records the remaining difference as an adjustment.
 */
export async function recheckReconciliation(db: Db, id: string, adjust: boolean): Promise<Reconciliation> {
  await db.transaction(async (tx) => {
    const rec = await tx.first<Row>('SELECT * FROM reconciliations WHERE id = ?', [id]);
    if (!rec) throw new LedgerError('Reconciliation not found.');
    if (rec.status !== 'open') throw new LedgerError('This reconciliation is already resolved.');
    const account = await requireAccount(tx, rec.account_id);
    const calculated = await accountBalance(tx, account.id, rec.date);
    const diff = rec.statement_balance_minor - calculated;
    const ts = nowISO();

    if (diff === 0) {
      await tx.run(
        `UPDATE reconciliations SET status = 'matched', calculated_balance_minor = ?, difference_minor = 0, resolved_at = ?
         WHERE id = ?`,
        [calculated, ts, id],
      );
    } else if (adjust) {
      const adjId = await insertAdjustment(
        tx,
        account.id,
        account.currency,
        rec.date,
        diff,
        rec.note ?? 'Balance adjustment from reconciliation',
      );
      await tx.run(
        `UPDATE reconciliations SET status = 'adjusted', calculated_balance_minor = ?, difference_minor = ?,
           adjustment_transaction_id = ?, resolved_at = ?
         WHERE id = ?`,
        [calculated, diff, adjId, ts, id],
      );
    } else {
      await tx.run('UPDATE reconciliations SET calculated_balance_minor = ?, difference_minor = ? WHERE id = ?', [
        calculated,
        diff,
        id,
      ]);
    }
  });
  return (await getReconciliation(db, id))!;
}
