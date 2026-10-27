/**
 * Company obligations (IS, TVA, payroll, CNSS, suppliers…). An obligation is
 * never money: it is paid by a real company expense or transfer that is linked
 * to it. Outstanding = amount − linked payments. Because the payment lowers
 * the company's cash and the obligation by the same amount, liquidity after
 * obligations does not move when a linked obligation is paid: nothing is
 * subtracted twice.
 *
 * One transaction can be split across obligations, but the linked parts never
 * exceed its amount, and a transaction that pays a distribution cannot also
 * pay an obligation.
 */
import { SYSTEM_CATEGORY } from '@/db/seed';
import { LedgerError, type BindValue, type Db } from '@/db/types';
import { addDays, daysBetweenInclusive, isValidISODate, todayISO } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import type { LiabilityKind } from '@/domain/types';
import { newId, nowISO } from '@/lib/id';
import { requireAccount, requireCompany } from './accounts';
import { saveExpense } from './ledger';

/** Category given to the expense created when an obligation is paid from its screen. */
export const LIABILITY_CATEGORY: Record<LiabilityKind, string | null> = {
  is: SYSTEM_CATEGORY.companyIs,
  tva: SYSTEM_CATEGORY.companyTva,
  payroll: SYSTEM_CATEGORY.companyPayroll,
  cnss: SYSTEM_CATEGORY.companyCnss,
  withholding: SYSTEM_CATEGORY.companyWithholding,
  dividend: SYSTEM_CATEGORY.companyDividendsOther,
  supplier: null,
  other: null,
};

/** Categories whose payments should be linked to an obligation. */
export const OBLIGATION_CATEGORIES = [
  SYSTEM_CATEGORY.companyIs,
  SYSTEM_CATEGORY.companyTva,
  SYSTEM_CATEGORY.companyCnss,
  SYSTEM_CATEGORY.companyWithholding,
];

export type LiabilityPayment = {
  id: string;
  transactionId: string;
  amountMinor: number;
  date: string;
  kind: string;
  note: string | null;
};

export type Liability = {
  id: string;
  companyId: string;
  fiscalYearId: string | null;
  distributionId: string | null;
  kind: LiabilityKind;
  label: string;
  amountMinor: number;
  currency: string;
  dueDate: string | null;
  notes: string | null;
  payments: LiabilityPayment[];
  paidMinor: number;
  outstandingMinor: number;
  status: 'open' | 'partial' | 'paid';
  overdue: boolean;
  /** Due within the next 14 days and not paid. */
  dueSoon: boolean;
  daysOverdue: number;
};

type LiabilityRow = {
  id: string;
  company_id: string;
  fiscal_year_id: string | null;
  distribution_id: string | null;
  kind: LiabilityKind;
  label: string;
  amount_minor: number;
  currency: string;
  due_date: string | null;
  notes: string | null;
};

/** Pure: outstanding amount and status. */
export function liabilityStatus(amountMinor: number, paidMinor: number, dueDate: string | null, today = todayISO()) {
  const outstanding = Math.max(0, amountMinor - paidMinor);
  const overdue = outstanding > 0 && dueDate !== null && dueDate < today;
  return {
    paidMinor,
    outstandingMinor: outstanding,
    status: (outstanding === 0 ? 'paid' : paidMinor > 0 ? 'partial' : 'open') as Liability['status'],
    overdue,
    dueSoon: outstanding > 0 && !overdue && dueDate !== null && dueDate <= addDays(today, 14),
    daysOverdue: overdue ? daysBetweenInclusive(dueDate!, today) - 1 : 0,
  };
}

export async function listLiabilities(db: Db, opts: { companyId?: string; id?: string } = {}): Promise<Liability[]> {
  const where: string[] = [];
  const params: BindValue[] = [];
  if (opts.companyId) {
    where.push('company_id = ?');
    params.push(opts.companyId);
  }
  if (opts.id) {
    where.push('id = ?');
    params.push(opts.id);
  }
  const [rows, payments] = await Promise.all([
    db.all<LiabilityRow>(
      `SELECT * FROM company_liabilities ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY due_date IS NULL, due_date, created_at`,
      params,
    ),
    db.all<{ id: string; liability_id: string; transaction_id: string; amount_minor: number; date: string; kind: string; note: string | null }>(
      `SELECT lp.id, lp.liability_id, lp.transaction_id, lp.amount_minor, t.date, t.kind, t.note
       FROM company_liability_payments lp
       JOIN transactions t ON t.id = lp.transaction_id AND t.deleted_at IS NULL
       ORDER BY t.date`,
    ),
  ]);
  const today = todayISO();
  return rows.map((r) => {
    const own = payments
      .filter((p) => p.liability_id === r.id)
      .map((p) => ({ id: p.id, transactionId: p.transaction_id, amountMinor: p.amount_minor, date: p.date, kind: p.kind, note: p.note }));
    const paid = own.reduce((s, p) => s + p.amountMinor, 0);
    return {
      id: r.id,
      companyId: r.company_id,
      fiscalYearId: r.fiscal_year_id,
      distributionId: r.distribution_id,
      kind: r.kind,
      label: r.label,
      amountMinor: r.amount_minor,
      currency: r.currency,
      dueDate: r.due_date,
      notes: r.notes,
      payments: own,
      ...liabilityStatus(r.amount_minor, paid, r.due_date, today),
    };
  });
}

export async function getLiability(db: Db, id: string): Promise<Liability | null> {
  return (await listLiabilities(db, { id }))[0] ?? null;
}

async function requireLiability(db: Db, id: string): Promise<Liability> {
  const l = await getLiability(db, id);
  if (!l) throw new LedgerError('Obligation not found.');
  return l;
}

export type LiabilityInput = {
  companyId: string;
  kind: LiabilityKind;
  label: string;
  amountMinor: number;
  dueDate?: string | null;
  fiscalYearId?: string | null;
  notes?: string | null;
};

export async function saveLiability(db: Db, input: LiabilityInput, id: string | null = null): Promise<string> {
  if (!input.label.trim()) throw new LedgerError('Describe the obligation.');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new LedgerError('Amount must be greater than zero.');
  if (input.dueDate && !isValidISODate(input.dueDate)) throw new LedgerError('Due date is invalid.');
  return db.transaction(async (tx) => {
    const company = await requireCompany(tx, input.companyId);
    if (input.fiscalYearId) {
      const fy = await tx.first<{ company_id: string }>('SELECT company_id FROM company_fiscal_years WHERE id = ?', [input.fiscalYearId]);
      if (!fy || fy.company_id !== company.id) throw new LedgerError('Fiscal year not found for this company.');
    }
    const ts = nowISO();
    if (id) {
      const existing = await requireLiability(tx, id);
      if (input.amountMinor < existing.paidMinor) {
        throw new LedgerError(`${formatMoney(existing.paidMinor, existing.currency)} is already paid against it. Unlink payments before lowering the amount below that.`);
      }
      await tx.run(
        `UPDATE company_liabilities SET kind = ?, label = ?, amount_minor = ?, due_date = ?, fiscal_year_id = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [input.kind, input.label.trim(), input.amountMinor, input.dueDate ?? null, input.fiscalYearId ?? null, input.notes?.trim() || null, ts, id],
      );
      return id;
    }
    const liabilityId = newId();
    await tx.run(
      `INSERT INTO company_liabilities (id, company_id, fiscal_year_id, kind, label, amount_minor, currency, due_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [liabilityId, company.id, input.fiscalYearId ?? null, input.kind, input.label.trim(), input.amountMinor, company.currency, input.dueDate ?? null, input.notes?.trim() || null, ts, ts],
    );
    return liabilityId;
  });
}

/** Deleting an obligation unlinks its payments; the payments themselves stay recorded. */
export async function deleteLiability(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM company_liability_payments WHERE liability_id = ?', [id]);
    await tx.run('DELETE FROM company_liabilities WHERE id = ?', [id]);
  });
}

type OutflowRow = { id: string; kind: string; amount_minor: number; currency: string; date: string; deleted_at: string | null; linked: number };

/** The transaction as a company outflow, with the part already linked to obligations. */
async function companyOutflow(tx: Db, transactionId: string, companyId: string): Promise<OutflowRow> {
  const t = await tx.first<OutflowRow>(
    `SELECT t.id, t.kind, t.amount_minor, t.currency, t.date, t.deleted_at,
       COALESCE((SELECT SUM(amount_minor) FROM company_liability_payments WHERE transaction_id = t.id), 0) AS linked
     FROM transactions t WHERE t.id = ?`,
    [transactionId],
  );
  if (!t || t.deleted_at) throw new LedgerError('Transaction not found.');
  const out = await tx.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM postings p JOIN accounts a ON a.id = p.account_id
     WHERE p.transaction_id = ? AND a.company_id = ? AND p.amount_minor < 0
       AND ((p.role = 'main' AND ? = 'expense') OR (p.role = 'from' AND ? = 'transfer'
         AND NOT EXISTS (SELECT 1 FROM postings q JOIN accounts b ON b.id = q.account_id
                         WHERE q.transaction_id = p.transaction_id AND q.role = 'to' AND b.company_id = a.company_id)))`,
    [transactionId, companyId, t.kind, t.kind],
  );
  if (!out?.n) throw new LedgerError('Only an expense or a transfer paid from this company’s accounts can pay its obligations.');
  const dist = await tx.first('SELECT id FROM distribution_payments WHERE transaction_id = ?', [transactionId]);
  if (dist) throw new LedgerError('This transfer already pays a distribution; it cannot also pay an obligation.');
  return t;
}

export type LinkPaymentInput = {
  liabilityId: string;
  transactionId: string;
  /** Part of the transaction that pays this obligation; defaults to as much as possible. */
  amountMinor?: number | null;
};

export async function linkLiabilityPayment(db: Db, input: LinkPaymentInput): Promise<void> {
  await db.transaction(async (tx) => {
    const l = await requireLiability(tx, input.liabilityId);
    const t = await companyOutflow(tx, input.transactionId, l.companyId);
    if (t.currency !== l.currency) throw new LedgerError(`Pay this obligation from a ${l.currency} account.`);
    if (l.payments.some((p) => p.transactionId === t.id)) throw new LedgerError('This payment is already linked to the obligation.');
    const free = t.amount_minor - t.linked;
    if (free <= 0) throw new LedgerError('This payment is already fully linked to other obligations.');
    if (l.outstandingMinor <= 0) throw new LedgerError('This obligation is already fully paid.');
    const amount = input.amountMinor ?? Math.min(free, l.outstandingMinor);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError('Amount must be greater than zero.');
    if (amount > free) {
      throw new LedgerError(`Only ${formatMoney(free, t.currency)} of this payment is not linked to another obligation yet.`);
    }
    if (amount > l.outstandingMinor) {
      throw new LedgerError(`Only ${formatMoney(l.outstandingMinor, l.currency)} is still outstanding on this obligation.`);
    }
    await tx.run(
      'INSERT INTO company_liability_payments (id, liability_id, transaction_id, amount_minor, created_at) VALUES (?, ?, ?, ?, ?)',
      [newId(), l.id, t.id, amount, nowISO()],
    );
  });
}

export async function unlinkLiabilityPayment(db: Db, paymentId: string): Promise<void> {
  await db.run('DELETE FROM company_liability_payments WHERE id = ?', [paymentId]);
}

export type PayLiabilityInput = {
  liabilityId: string;
  accountId: string;
  date: string;
  amountMinor: number;
  note?: string | null;
};

/** Records the real company expense that pays an obligation and links it, atomically. */
export async function payLiability(db: Db, input: PayLiabilityInput): Promise<string> {
  return db.transaction(async (tx) => {
    const l = await requireLiability(tx, input.liabilityId);
    const account = await requireAccount(tx, input.accountId);
    if (account.companyId !== l.companyId) throw new LedgerError('Pay a company obligation from one of that company’s accounts.');
    if (input.amountMinor > l.outstandingMinor) {
      throw new LedgerError(`Only ${formatMoney(l.outstandingMinor, l.currency)} is outstanding. Record any extra separately.`);
    }
    const txId = await saveExpense(tx, {
      date: input.date,
      amountMinor: input.amountMinor,
      accountId: account.id,
      categoryId: LIABILITY_CATEGORY[l.kind],
      note: input.note?.trim() || `Payment: ${l.label}`,
    });
    await linkLiabilityPayment(tx, { liabilityId: l.id, transactionId: txId, amountMinor: input.amountMinor });
    return txId;
  });
}

export type PaymentCandidate = {
  transactionId: string;
  date: string;
  kind: string;
  amountMinor: number;
  /** Part not yet linked to any obligation. */
  freeMinor: number;
  label: string;
  categoryId: string | null;
};

/** Company outflows that can still (partly) pay obligations, newest first. Category matches come first. */
export async function paymentCandidates(db: Db, liabilityId: string): Promise<PaymentCandidate[]> {
  const l = await requireLiability(db, liabilityId);
  const rows = await db.all<{
    id: string;
    date: string;
    kind: string;
    amount_minor: number;
    currency: string;
    category_id: string | null;
    category: string | null;
    merchant: string | null;
    note: string | null;
    transfer_class: string | null;
    linked: number;
  }>(
    `SELECT t.id, t.date, t.kind, t.amount_minor, t.currency, t.category_id, c.name AS category, m.name AS merchant, t.note,
       t.transfer_class, COALESCE((SELECT SUM(amount_minor) FROM company_liability_payments WHERE transaction_id = t.id), 0) AS linked
     FROM transactions t
     JOIN postings p ON p.transaction_id = t.id AND p.amount_minor < 0
     JOIN accounts a ON a.id = p.account_id AND a.company_id = ?
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE t.deleted_at IS NULL AND t.parent_id IS NULL
       AND ((t.kind = 'expense' AND p.role = 'main')
         OR (t.kind = 'transfer' AND p.role = 'from' AND NOT EXISTS (
           SELECT 1 FROM postings q JOIN accounts b ON b.id = q.account_id
           WHERE q.transaction_id = t.id AND q.role = 'to' AND b.company_id = a.company_id)))
       AND NOT EXISTS (SELECT 1 FROM distribution_payments dp WHERE dp.transaction_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM company_liability_payments lp WHERE lp.transaction_id = t.id AND lp.liability_id = ?)
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT 200`,
    [l.companyId, l.id],
  );
  const preferred = LIABILITY_CATEGORY[l.kind];
  return rows
    .filter((r) => r.currency === l.currency && r.amount_minor - r.linked > 0)
    .map((r) => ({
      transactionId: r.id,
      date: r.date,
      kind: r.kind,
      amountMinor: r.amount_minor,
      freeMinor: r.amount_minor - r.linked,
      label: r.merchant ?? r.note ?? r.category ?? (r.kind === 'transfer' ? `Transfer (${r.transfer_class})` : 'Expense'),
      categoryId: r.category_id,
    }))
    .sort((a, b) => Number(b.categoryId === preferred && !!preferred) - Number(a.categoryId === preferred && !!preferred));
}

export type UnlinkedPayment = { transactionId: string; date: string; amountMinor: number; categoryId: string; categoryName: string };

/**
 * Tax and withholding payments not linked to any obligation. Their obligation
 * (if recorded) still looks unpaid while the cash has already gone, so
 * liquidity would count them twice.
 */
export async function unlinkedObligationPayments(db: Db, companyId: string): Promise<UnlinkedPayment[]> {
  const rows = await db.all<{ id: string; date: string; amount_minor: number; category_id: string; name: string }>(
    `SELECT t.id, t.date, t.amount_minor, t.category_id, c.name
     FROM transactions t
     JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     JOIN accounts a ON a.id = p.account_id AND a.company_id = ?
     JOIN categories c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.kind = 'expense'
       AND t.category_id IN (${OBLIGATION_CATEGORIES.map(() => '?').join(',')})
       AND NOT EXISTS (SELECT 1 FROM company_liability_payments lp WHERE lp.transaction_id = t.id)
     ORDER BY t.date DESC`,
    [companyId, ...OBLIGATION_CATEGORIES],
  );
  return rows.map((r) => ({ transactionId: r.id, date: r.date, amountMinor: r.amount_minor, categoryId: r.category_id, categoryName: r.name }));
}

/** Obligations each transaction pays (for the transaction detail screen). */
export async function transactionLinks(db: Db, transactionId: string) {
  const [liabilities, distributions] = await Promise.all([
    db.all<{ id: string; label: string; amount_minor: number; company_id: string }>(
      `SELECT l.id, l.label, lp.amount_minor, l.company_id FROM company_liability_payments lp
       JOIN company_liabilities l ON l.id = lp.liability_id WHERE lp.transaction_id = ?`,
      [transactionId],
    ),
    db.all<{ id: string; approved_at: string; company_id: string }>(
      `SELECT d.id, d.approved_at, d.company_id FROM distribution_payments dp
       JOIN distributions d ON d.id = dp.distribution_id WHERE dp.transaction_id = ?`,
      [transactionId],
    ),
  ]);
  return {
    liabilities: liabilities.map((l) => ({ id: l.id, label: l.label, amountMinor: l.amount_minor, companyId: l.company_id })),
    distributions: distributions.map((d) => ({ id: d.id, approvedAt: d.approved_at, companyId: d.company_id })),
  };
}
