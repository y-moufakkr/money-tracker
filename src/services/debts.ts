/**
 * Personal debts (money I owe) and receivables (money owed to me).
 *
 * A debt record is never money. Money moves only in real transactions:
 * - the loan itself (borrowed into / lent from a location) is a `debt` transaction: the balance
 *   changes, but it is never income or expense;
 * - a repayment is a `debt` transaction linked to the debt (principal), optionally with interest
 *   recorded as a linked "Loan interest" expense;
 * - an existing expense or income can also be linked as a repayment (for example a friend paid
 *   for my ticket, and I repay them: the repayment is the real expense).
 *
 * Outstanding = principal − linked repayments. Money owed to me is a receivable: it is shown
 * separately and never counted as cash. Money I owe is a liability next to credit cards.
 * A transaction repays at most one debt (UNIQUE), so no repayment is counted twice.
 */
import { LedgerError, type BindValue, type Db } from '@/db/types';
import { addDays, daysBetweenInclusive, isValidISODate, todayISO } from '@/domain/dates';
import { BASE_CURRENCY, formatMoney } from '@/domain/money';
import { newId, nowISO } from '@/lib/id';
import { requireAccount } from './accounts';
import { deleteTransaction, saveDebtMovement } from './ledger';

export type DebtDirection = 'owe' | 'owed';

export type DebtPayment = {
  id: string;
  transactionId: string;
  /** Part of the transaction that repays this debt. */
  amountMinor: number;
  date: string;
  kind: string;
  note: string | null;
  accountName: string | null;
};

export type DebtStatus = 'open' | 'partial' | 'paid' | 'closed';

export type Debt = {
  id: string;
  direction: DebtDirection;
  counterparty: string;
  principalMinor: number;
  currency: string;
  startDate: string;
  dueDate: string | null;
  originTransactionId: string | null;
  /** Location the money moved through at the start, when recorded. */
  originAccount: { id: string; name: string } | null;
  notes: string | null;
  closedAt: string | null;
  closeNote: string | null;
  payments: DebtPayment[];
  paidMinor: number;
  outstandingMinor: number;
  status: DebtStatus;
  overdue: boolean;
  dueSoon: boolean;
  daysOverdue: number;
};

type DebtRow = {
  id: string;
  direction: DebtDirection;
  counterparty: string;
  principal_minor: number;
  currency: string;
  start_date: string;
  due_date: string | null;
  origin_transaction_id: string | null;
  origin_account_id: string | null;
  origin_account_name: string | null;
  notes: string | null;
  closed_at: string | null;
  close_note: string | null;
};

/** Pure: what is left and how urgent it is. A closed debt is no longer counted anywhere. */
export function debtStatus(
  principalMinor: number,
  paidMinor: number,
  dueDate: string | null,
  closedAt: string | null,
  today = todayISO(),
) {
  const outstanding = Math.max(0, principalMinor - paidMinor);
  const open = outstanding > 0 && !closedAt;
  const overdue = open && dueDate !== null && dueDate < today;
  return {
    paidMinor,
    outstandingMinor: closedAt ? 0 : outstanding,
    status: (closedAt && outstanding > 0 ? 'closed' : outstanding === 0 ? 'paid' : paidMinor > 0 ? 'partial' : 'open') as DebtStatus,
    overdue,
    dueSoon: open && !overdue && dueDate !== null && dueDate <= addDays(today, 14),
    daysOverdue: overdue ? daysBetweenInclusive(dueDate!, today) - 1 : 0,
  };
}

const DEBT_SELECT = `
  SELECT d.*, a.id AS origin_account_id, a.name AS origin_account_name
  FROM debts d
  LEFT JOIN transactions ot ON ot.id = d.origin_transaction_id AND ot.deleted_at IS NULL
  LEFT JOIN postings op ON op.transaction_id = ot.id AND op.role = 'main'
  LEFT JOIN accounts a ON a.id = op.account_id`;

/** Repayments of live transactions. A linked part never counts for more than its transaction. */
const PAYMENTS_SELECT = `
  SELECT dp.id, dp.debt_id, dp.transaction_id, MIN(dp.amount_minor, t.amount_minor) AS amount_minor,
    t.date, t.kind, t.note, a.name AS account_name
  FROM debt_payments dp
  JOIN transactions t ON t.id = dp.transaction_id AND t.deleted_at IS NULL
  LEFT JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
  LEFT JOIN accounts a ON a.id = p.account_id`;

type PaymentRow = {
  id: string;
  debt_id: string;
  transaction_id: string;
  amount_minor: number;
  date: string;
  kind: string;
  note: string | null;
  account_name: string | null;
};

export async function listDebts(db: Db, opts: { id?: string; direction?: DebtDirection } = {}): Promise<Debt[]> {
  const where: string[] = [];
  const params: BindValue[] = [];
  if (opts.id) {
    where.push('d.id = ?');
    params.push(opts.id);
  }
  if (opts.direction) {
    where.push('d.direction = ?');
    params.push(opts.direction);
  }
  const [rows, payments] = await Promise.all([
    db.all<DebtRow>(
      `${DEBT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY d.closed_at IS NOT NULL, d.due_date IS NULL, d.due_date, d.start_date DESC, d.created_at`,
      params,
    ),
    db.all<PaymentRow>(`${PAYMENTS_SELECT} ${opts.id ? 'WHERE dp.debt_id = ?' : ''} ORDER BY t.date, t.created_at`, opts.id ? [opts.id] : []),
  ]);
  const today = todayISO();
  return rows.map((r) => {
    const own = payments
      .filter((p) => p.debt_id === r.id)
      .map((p) => ({
        id: p.id,
        transactionId: p.transaction_id,
        amountMinor: p.amount_minor,
        date: p.date,
        kind: p.kind,
        note: p.note,
        accountName: p.account_name,
      }));
    const paid = own.reduce((s, p) => s + p.amountMinor, 0);
    return {
      id: r.id,
      direction: r.direction,
      counterparty: r.counterparty,
      principalMinor: r.principal_minor,
      currency: r.currency,
      startDate: r.start_date,
      dueDate: r.due_date,
      originTransactionId: r.origin_transaction_id,
      originAccount: r.origin_account_id ? { id: r.origin_account_id, name: r.origin_account_name ?? '' } : null,
      notes: r.notes,
      closedAt: r.closed_at,
      closeNote: r.close_note,
      payments: own,
      ...debtStatus(r.principal_minor, paid, r.due_date, r.closed_at, today),
    };
  });
}

export async function getDebt(db: Db, id: string): Promise<Debt | null> {
  return (await listDebts(db, { id }))[0] ?? null;
}

async function requireDebt(db: Db, id: string): Promise<Debt> {
  const d = await getDebt(db, id);
  if (!d) throw new LedgerError('Debt not found.');
  return d;
}

export type DebtOutstanding = { id: string; direction: DebtDirection; currency: string; outstandingMinor: number };

/**
 * What each debt still amounted to at the end of `asOf`: started by then, not closed by then,
 * principal minus repayments dated on or before it. Used by My Money (and its history).
 */
export async function debtsOutstanding(db: Db, asOf: string = todayISO()): Promise<DebtOutstanding[]> {
  const rows = await db.all<{ id: string; direction: DebtDirection; currency: string; principal_minor: number; paid: number }>(
    `SELECT d.id, d.direction, d.currency, d.principal_minor,
       COALESCE((SELECT SUM(MIN(dp.amount_minor, t.amount_minor)) FROM debt_payments dp
                 JOIN transactions t ON t.id = dp.transaction_id AND t.deleted_at IS NULL
                 WHERE dp.debt_id = d.id AND t.date <= ?), 0) AS paid
     FROM debts d
     WHERE d.start_date <= ? AND (d.closed_at IS NULL OR substr(d.closed_at, 1, 10) > ?)`,
    [asOf, asOf, asOf],
  );
  return rows
    .map((r) => ({ id: r.id, direction: r.direction, currency: r.currency, outstandingMinor: Math.max(0, r.principal_minor - r.paid) }))
    .filter((r) => r.outstandingMinor > 0);
}

export type DebtInput = {
  direction: DebtDirection;
  counterparty: string;
  principalMinor: number;
  startDate: string;
  dueDate?: string | null;
  notes?: string | null;
  /**
   * Where the money moved at the start: received into (I borrowed) or paid from (I lent).
   * Null when no money moved (the debt predates tracking, or someone paid something for me).
   */
  originAccountId?: string | null;
  /** Currency when no money moved; otherwise the location's currency. */
  currency?: string | null;
};

function originNote(direction: DebtDirection, counterparty: string) {
  return direction === 'owe' ? `Borrowed from ${counterparty}` : `Lent to ${counterparty}`;
}

/**
 * Creates or updates a debt. When money moved at the start, a `debt` transaction records it (and
 * is rewritten or removed with the debt's amount, date and location), so the balance and the
 * debt always agree.
 */
export async function saveDebt(db: Db, input: DebtInput, id: string | null = null): Promise<string> {
  const counterparty = input.counterparty.trim();
  if (!counterparty) throw new LedgerError(input.direction === 'owe' ? 'Who do you owe?' : 'Who owes you?');
  if (!Number.isSafeInteger(input.principalMinor) || input.principalMinor <= 0) throw new LedgerError('Amount must be greater than zero.');
  if (!isValidISODate(input.startDate)) throw new LedgerError('Start date is invalid.');
  if (input.dueDate && !isValidISODate(input.dueDate)) throw new LedgerError('Due date is invalid.');
  if (input.dueDate && input.dueDate < input.startDate) throw new LedgerError('The due date is before the start date.');

  return db.transaction(async (tx) => {
    const existing = id ? await requireDebt(tx, id) : null;
    if (existing && existing.direction !== input.direction) {
      throw new LedgerError('A debt cannot change direction. Delete it and record it again.');
    }
    let currency = (input.currency ?? existing?.currency ?? BASE_CURRENCY).toUpperCase();
    if (input.originAccountId) currency = (await requireAccount(tx, input.originAccountId)).currency;
    if (existing && existing.payments.length > 0 && currency !== existing.currency) {
      throw new LedgerError(`Repayments are recorded in ${existing.currency}. Keep the debt in ${existing.currency}.`);
    }
    if (existing && input.principalMinor < existing.paidMinor) {
      throw new LedgerError(`${formatMoney(existing.paidMinor, existing.currency)} is already repaid. The amount cannot be lower than that.`);
    }

    const debtId = existing?.id ?? newId();
    let originId = existing?.originTransactionId ?? null;
    const movement = {
      date: input.startDate,
      amountMinor: input.principalMinor,
      direction: input.direction === 'owe' ? ('in' as const) : ('out' as const),
      note: originNote(input.direction, counterparty),
    };
    if (input.originAccountId) {
      originId = await saveDebtMovement(tx, { ...movement, accountId: input.originAccountId }, originId);
    } else if (originId) {
      await deleteTransaction(tx, originId);
      originId = null;
    }

    const ts = nowISO();
    const values = [input.direction, counterparty, input.principalMinor, currency, input.startDate, input.dueDate ?? null, originId, input.notes?.trim() || null];
    if (existing) {
      await tx.run(
        `UPDATE debts SET direction = ?, counterparty = ?, principal_minor = ?, currency = ?, start_date = ?, due_date = ?,
           origin_transaction_id = ?, notes = ?, updated_at = ? WHERE id = ?`,
        [...values, ts, debtId],
      );
    } else {
      await tx.run(
        `INSERT INTO debts (direction, counterparty, principal_minor, currency, start_date, due_date, origin_transaction_id, notes,
           id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...values, debtId, ts, ts],
      );
    }
    return debtId;
  });
}

/**
 * Deletes the debt record. Repayments and the starting movement stay recorded: they are real
 * money movements (their notes still name the person).
 */
export async function deleteDebt(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('UPDATE recurring_rules SET debt_id = NULL, updated_at = ? WHERE debt_id = ?', [nowISO(), id]);
    await tx.run('DELETE FROM debt_payments WHERE debt_id = ?', [id]);
    await tx.run('DELETE FROM debts WHERE id = ?', [id]);
  });
}

/**
 * Closes a debt that will not be repaid in full (forgiven, written off, settled otherwise). Its
 * remaining balance stops counting as a liability or receivable from that date. Reversible.
 */
export async function setDebtClosed(db: Db, id: string, closed: boolean, note: string | null = null, at = nowISO()): Promise<void> {
  await db.transaction(async (tx) => {
    const d = await requireDebt(tx, id);
    if (closed && d.status === 'paid') throw new LedgerError('This debt is already fully repaid.');
    await tx.run('UPDATE debts SET closed_at = ?, close_note = ?, updated_at = ? WHERE id = ?', [
      closed ? at : null,
      closed ? note?.trim() || null : null,
      nowISO(),
      id,
    ]);
  });
}

export type RepaymentInput = {
  debtId: string;
  accountId: string;
  date: string;
  /** Principal repaid. */
  amountMinor: number;
  /** Interest paid on top (debts I owe only). */
  interestMinor?: number | null;
  note?: string | null;
};

/** Records a repayment (a `debt` transaction, plus interest as an expense) and links it, atomically. */
export async function recordRepayment(db: Db, input: RepaymentInput): Promise<string> {
  return db.transaction(async (tx) => {
    const d = await requireDebt(tx, input.debtId);
    if (d.closedAt) throw new LedgerError('This debt is closed. Reopen it first.');
    if (input.amountMinor > d.outstandingMinor) {
      throw new LedgerError(`Only ${formatMoney(d.outstandingMinor, d.currency)} is outstanding. Record any extra separately.`);
    }
    const account = await requireAccount(tx, input.accountId);
    if (account.currency !== d.currency) throw new LedgerError(`This debt is in ${d.currency}. Choose a ${d.currency} location.`);
    const txId = await saveDebtMovement(tx, {
      date: input.date,
      accountId: account.id,
      amountMinor: input.amountMinor,
      direction: d.direction === 'owe' ? 'out' : 'in',
      interestMinor: input.interestMinor,
      note: input.note?.trim() || (d.direction === 'owe' ? `Repaid ${d.counterparty}` : `Repayment from ${d.counterparty}`),
    });
    await linkRepayment(tx, { debtId: d.id, transactionId: txId });
    return txId;
  });
}

type TxRow = { id: string; kind: string; amount_minor: number; currency: string; deleted_at: string | null; signed: number | null; ownership: string | null };

async function loadTx(tx: Db, transactionId: string): Promise<TxRow> {
  const t = await tx.first<TxRow>(
    `SELECT t.id, t.kind, t.amount_minor, t.currency, t.deleted_at, p.amount_minor AS signed, a.ownership
     FROM transactions t
     LEFT JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     LEFT JOIN accounts a ON a.id = p.account_id
     WHERE t.id = ?`,
    [transactionId],
  );
  if (!t || t.deleted_at) throw new LedgerError('Transaction not found.');
  return t;
}

/** Whether a transaction can repay a debt of this direction. */
function repaysDirection(t: TxRow, direction: DebtDirection): boolean {
  if (t.ownership !== 'personal') return false;
  if (direction === 'owe') return t.kind === 'expense' || (t.kind === 'debt' && (t.signed ?? 0) < 0);
  return t.kind === 'income' || (t.kind === 'debt' && (t.signed ?? 0) > 0);
}

export type LinkRepaymentInput = {
  debtId: string;
  transactionId: string;
  /** Defaults to as much as possible. A `debt` movement is always linked in full. */
  amountMinor?: number | null;
};

export async function linkRepayment(db: Db, input: LinkRepaymentInput): Promise<void> {
  await db.transaction(async (tx) => {
    const d = await requireDebt(tx, input.debtId);
    if (d.closedAt) throw new LedgerError('This debt is closed. Reopen it first.');
    const t = await loadTx(tx, input.transactionId);
    if (!repaysDirection(t, d.direction)) {
      throw new LedgerError(
        d.direction === 'owe'
          ? 'Only a personal expense or an outgoing loan repayment can repay a debt you owe.'
          : 'Only personal income or an incoming loan repayment can repay money owed to you.',
      );
    }
    if (t.currency !== d.currency) throw new LedgerError(`This debt is in ${d.currency}; the transaction is in ${t.currency}.`);
    const used = await tx.first<{ debt_id: string }>('SELECT debt_id FROM debt_payments WHERE transaction_id = ?', [t.id]);
    if (used) throw new LedgerError(used.debt_id === d.id ? 'This payment is already linked to the debt.' : 'This payment already repays another debt.');
    const origin = await tx.first('SELECT id FROM debts WHERE origin_transaction_id = ?', [t.id]);
    if (origin) throw new LedgerError('This movement is the start of a debt, not a repayment.');
    if (d.outstandingMinor <= 0) throw new LedgerError('Nothing is outstanding on this debt.');

    const amount = t.kind === 'debt' ? t.amount_minor : (input.amountMinor ?? Math.min(t.amount_minor, d.outstandingMinor));
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError('Amount must be greater than zero.');
    if (amount > t.amount_minor) throw new LedgerError(`The transaction is only ${formatMoney(t.amount_minor, t.currency)}.`);
    if (amount > d.outstandingMinor) {
      throw new LedgerError(`Only ${formatMoney(d.outstandingMinor, d.currency)} is outstanding on this debt.`);
    }
    await tx.run('INSERT INTO debt_payments (id, debt_id, transaction_id, amount_minor, created_at) VALUES (?, ?, ?, ?, ?)', [
      newId(),
      d.id,
      t.id,
      amount,
      nowISO(),
    ]);
  });
}

/** Unlinks a repayment; the transaction itself stays recorded. */
export async function unlinkRepayment(db: Db, paymentId: string): Promise<void> {
  await db.run('DELETE FROM debt_payments WHERE id = ?', [paymentId]);
}

export type RepaymentCandidate = { transactionId: string; date: string; kind: string; amountMinor: number; label: string; accountName: string };

/** Recent personal transactions that could repay this debt and repay nothing yet, newest first. */
export async function repaymentCandidates(db: Db, debtId: string): Promise<RepaymentCandidate[]> {
  const d = await requireDebt(db, debtId);
  const rows = await db.all<{
    id: string;
    date: string;
    kind: string;
    amount_minor: number;
    signed: number;
    note: string | null;
    merchant: string | null;
    category: string | null;
    account_name: string;
  }>(
    `SELECT t.id, t.date, t.kind, t.amount_minor, p.amount_minor AS signed, t.note, m.name AS merchant, c.name AS category, a.name AS account_name
     FROM transactions t
     JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     JOIN accounts a ON a.id = p.account_id AND a.ownership = 'personal'
     LEFT JOIN merchants m ON m.id = t.merchant_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.currency = ? AND t.parent_id IS NULL AND t.date >= ?
       AND ${d.direction === 'owe' ? `(t.kind = 'expense' OR (t.kind = 'debt' AND p.amount_minor < 0))` : `(t.kind = 'income' OR (t.kind = 'debt' AND p.amount_minor > 0))`}
       AND NOT EXISTS (SELECT 1 FROM debt_payments dp WHERE dp.transaction_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM debts x WHERE x.origin_transaction_id = t.id)
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT 100`,
    [d.currency, d.startDate],
  );
  return rows.map((r) => ({
    transactionId: r.id,
    date: r.date,
    kind: r.kind,
    amountMinor: r.amount_minor,
    label: r.merchant ?? r.note ?? r.category ?? (r.kind === 'debt' ? 'Loan repayment' : r.kind),
    accountName: r.account_name,
  }));
}

/** The debt a transaction starts or repays (transaction detail screen). */
export async function transactionDebt(db: Db, transactionId: string) {
  const row = await db.first<{ id: string; counterparty: string; direction: DebtDirection; role: 'origin' | 'repayment' }>(
    `SELECT id, counterparty, direction, 'origin' AS role FROM debts WHERE origin_transaction_id = ?
     UNION ALL
     SELECT d.id, d.counterparty, d.direction, 'repayment' AS role FROM debt_payments dp JOIN debts d ON d.id = dp.debt_id
     WHERE dp.transaction_id = ?`,
    [transactionId, transactionId],
  );
  return row;
}
