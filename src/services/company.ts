/**
 * Company money: fiscal years, user-entered tax assumptions, reserves, the
 * company P&L and the tax estimate. Nothing here moves money or touches a
 * balance; every figure is derived from recorded transactions plus figures the
 * user entered, and each estimate step carries its calculation.
 *
 * P&L rules (cash basis, from recorded transactions on the company's accounts):
 * - Revenue = income, except the "capital, loans & refunds" category.
 * - Expenses = expenses, except corporate tax (IS), TVA paid to the state,
 *   dividend withholding, dividends to other partners and loan principal.
 *   Company → you salary and expense-reimbursement transfers are expenses too
 *   (payroll / reimbursed costs). They are your personal income or refund on
 *   the personal side: two different views of one movement, counted once in each.
 * - Every other transfer (dividends, owner loans, loan repayments, capital
 *   contributions, internal moves) and balance adjustments are not P&L.
 */
import { SYSTEM_CATEGORY } from '@/db/seed';
import { LedgerError, type BindValue, type Db } from '@/db/types';
import { addDays, addMonths, formatDateLabel, isValidISODate, todayISO, type DateRange } from '@/domain/dates';
import { applyBp, BASE_CURRENCY, convertToBase, formatBp, formatMoney } from '@/domain/money';
import type {
  Company,
  CompanyReserve,
  FiscalYear,
  ReserveKind,
  TaxAssumptions,
  TaxItem,
  TaxItemKind,
  TransferClass,
} from '@/domain/types';
import { newId, nowISO } from '@/lib/id';
import { requireCompany } from './accounts';
import { loadExpenseFacts, type ExpenseFact, type ExpenseFacts } from './analytics';
import { latestRates } from './fx';
import type { TransactionFilter } from './queries';

const clean = (s: string | null | undefined) => s?.trim() || null;

function assertBp(v: number | null | undefined, label: string) {
  if (v !== null && v !== undefined && (!Number.isInteger(v) || v < 0 || v > 10000)) {
    throw new LedgerError(`${label} must be between 0% and 100%.`);
  }
}

function assertMinor(v: number | null | undefined, label: string, opts: { signed?: boolean } = {}) {
  if (v === null || v === undefined) return;
  if (!Number.isSafeInteger(v) || (!opts.signed && v < 0)) throw new LedgerError(`${label} is invalid.`);
}

// ---------------------------------------------------------------------------
// Fiscal years

type FiscalYearRow = {
  id: string;
  company_id: string;
  label: string;
  start_date: string;
  end_date: string;
  is_closed: number;
  notes: string | null;
};

const mapFiscalYear = (r: FiscalYearRow): FiscalYear => ({
  id: r.id,
  companyId: r.company_id,
  label: r.label,
  startDate: r.start_date,
  endDate: r.end_date,
  isClosed: r.is_closed === 1,
  notes: r.notes,
});

/** The fiscal year containing `date` for a company whose year starts in `startMonth`. */
export function fiscalYearBounds(startMonth: number, date: string = todayISO()) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const startYear = m >= startMonth ? y : y - 1;
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  return {
    startDate,
    endDate: addDays(addMonths(startDate, 12), -1),
    label: startMonth === 1 ? String(startYear) : `${startYear}–${String(startYear + 1).slice(2)}`,
  };
}

export async function listFiscalYears(db: Db, companyId: string): Promise<FiscalYear[]> {
  const rows = await db.all<FiscalYearRow>(
    'SELECT * FROM company_fiscal_years WHERE company_id = ? ORDER BY start_date DESC',
    [companyId],
  );
  return rows.map(mapFiscalYear);
}

export async function getFiscalYear(db: Db, id: string): Promise<FiscalYear | null> {
  const r = await db.first<FiscalYearRow>('SELECT * FROM company_fiscal_years WHERE id = ?', [id]);
  return r ? mapFiscalYear(r) : null;
}

export async function requireFiscalYear(db: Db, id: string): Promise<FiscalYear> {
  const fy = await getFiscalYear(db, id);
  if (!fy) throw new LedgerError('Fiscal year not found.');
  return fy;
}

/** The latest fiscal year that has started (the one estimates and the dashboard use). */
export function currentFiscalYear(years: FiscalYear[], today = todayISO()): FiscalYear | null {
  return years.filter((y) => y.startDate <= today).sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null;
}

export type FiscalYearInput = {
  companyId: string;
  label: string;
  startDate: string;
  endDate: string;
  isClosed?: boolean;
  notes?: string | null;
};

export async function saveFiscalYear(db: Db, input: FiscalYearInput, id: string | null = null): Promise<string> {
  if (!clean(input.label)) throw new LedgerError('Give the fiscal year a name, e.g. 2026.');
  if (!isValidISODate(input.startDate) || !isValidISODate(input.endDate)) throw new LedgerError('Fiscal year dates are invalid.');
  if (input.startDate > input.endDate) throw new LedgerError('The fiscal year must end after it starts.');
  if (input.endDate > addDays(addMonths(input.startDate, 24), -1)) throw new LedgerError('A fiscal year cannot be longer than 24 months.');
  return db.transaction(async (tx) => {
    await requireCompany(tx, input.companyId);
    const overlap = await tx.first<{ label: string }>(
      `SELECT label FROM company_fiscal_years
       WHERE company_id = ? AND id <> ? AND NOT (end_date < ? OR start_date > ?)`,
      [input.companyId, id ?? '', input.startDate, input.endDate],
    );
    if (overlap) throw new LedgerError(`These dates overlap fiscal year ${overlap.label}.`);
    const ts = nowISO();
    if (id) {
      const r = await tx.run(
        `UPDATE company_fiscal_years SET label = ?, start_date = ?, end_date = ?, is_closed = ?, notes = ?, updated_at = ?
         WHERE id = ? AND company_id = ?`,
        [input.label.trim(), input.startDate, input.endDate, input.isClosed ? 1 : 0, clean(input.notes), ts, id, input.companyId],
      );
      if (r.changes === 0) throw new LedgerError('Fiscal year not found.');
      return id;
    }
    const newFy = newId();
    await tx.run(
      `INSERT INTO company_fiscal_years (id, company_id, label, start_date, end_date, is_closed, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newFy, input.companyId, input.label.trim(), input.startDate, input.endDate, input.isClosed ? 1 : 0, clean(input.notes), ts, ts],
    );
    return newFy;
  });
}

/** Only a fiscal year nothing refers to can be deleted (its assumptions go with it). */
export async function deleteFiscalYear(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const used = await tx.first<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM company_liabilities WHERE fiscal_year_id = ?)
            + (SELECT COUNT(*) FROM company_reserves WHERE fiscal_year_id = ?)
            + (SELECT COUNT(*) FROM distributions WHERE fiscal_year_id = ?)
            + (SELECT COUNT(*) FROM distribution_simulations WHERE fiscal_year_id = ?) AS n`,
      [id, id, id, id],
    );
    if ((used?.n ?? 0) > 0) {
      throw new LedgerError('Obligations, reserves, simulations or distributions refer to this fiscal year. Remove them first.');
    }
    await tx.run('DELETE FROM company_fiscal_years WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Tax assumptions and items (all user-entered, per fiscal year)

type AssumptionRow = {
  fiscal_year_id: string;
  is_rate_bp: number | null;
  is_minimum_minor: number | null;
  is_override_minor: number | null;
  is_paid_outside_minor: number;
  withholding_rate_bp: number | null;
  legal_reserve_rate_bp: number | null;
  tva_collected_minor: number | null;
  tva_deductible_minor: number | null;
  pre_tracking_revenue_minor: number | null;
  pre_tracking_expenses_minor: number | null;
  retained_earnings_minor: number;
  source_note: string | null;
  updated_at: string;
};

export function emptyAssumptions(fiscalYearId: string): TaxAssumptions {
  return {
    fiscalYearId,
    isRateBp: null,
    isMinimumMinor: null,
    isOverrideMinor: null,
    isPaidOutsideMinor: 0,
    withholdingRateBp: null,
    legalReserveRateBp: null,
    tvaCollectedMinor: null,
    tvaDeductibleMinor: null,
    preTrackingRevenueMinor: null,
    preTrackingExpensesMinor: null,
    retainedEarningsMinor: 0,
    sourceNote: null,
    updatedAt: null,
  };
}

export async function getTaxAssumptions(db: Db, fiscalYearId: string): Promise<TaxAssumptions> {
  const r = await db.first<AssumptionRow>('SELECT * FROM tax_assumptions WHERE fiscal_year_id = ?', [fiscalYearId]);
  if (!r) return emptyAssumptions(fiscalYearId);
  return {
    fiscalYearId: r.fiscal_year_id,
    isRateBp: r.is_rate_bp,
    isMinimumMinor: r.is_minimum_minor,
    isOverrideMinor: r.is_override_minor,
    isPaidOutsideMinor: r.is_paid_outside_minor,
    withholdingRateBp: r.withholding_rate_bp,
    legalReserveRateBp: r.legal_reserve_rate_bp,
    tvaCollectedMinor: r.tva_collected_minor,
    tvaDeductibleMinor: r.tva_deductible_minor,
    preTrackingRevenueMinor: r.pre_tracking_revenue_minor,
    preTrackingExpensesMinor: r.pre_tracking_expenses_minor,
    retainedEarningsMinor: r.retained_earnings_minor,
    sourceNote: r.source_note,
    updatedAt: r.updated_at,
  };
}

export type TaxAssumptionsInput = Omit<TaxAssumptions, 'fiscalYearId' | 'updatedAt'>;

export async function saveTaxAssumptions(db: Db, fiscalYearId: string, a: TaxAssumptionsInput): Promise<void> {
  assertBp(a.isRateBp, 'The IS rate');
  assertBp(a.withholdingRateBp, 'The withholding rate');
  assertBp(a.legalReserveRateBp, 'The legal reserve rate');
  assertMinor(a.isMinimumMinor, 'Minimum tax');
  assertMinor(a.isOverrideMinor, 'IS amount');
  assertMinor(a.isPaidOutsideMinor, 'IS paid outside the app');
  assertMinor(a.tvaCollectedMinor, 'TVA collected');
  assertMinor(a.tvaDeductibleMinor, 'TVA deductible');
  assertMinor(a.preTrackingRevenueMinor, 'Revenue before tracking');
  assertMinor(a.preTrackingExpensesMinor, 'Expenses before tracking');
  assertMinor(a.retainedEarningsMinor, 'Retained earnings', { signed: true });
  await db.transaction(async (tx) => {
    await requireFiscalYear(tx, fiscalYearId);
    const ts = nowISO();
    const values: BindValue[] = [
      a.isRateBp,
      a.isMinimumMinor,
      a.isOverrideMinor,
      a.isPaidOutsideMinor,
      a.withholdingRateBp,
      a.legalReserveRateBp,
      a.tvaCollectedMinor,
      a.tvaDeductibleMinor,
      a.preTrackingRevenueMinor,
      a.preTrackingExpensesMinor,
      a.retainedEarningsMinor,
      clean(a.sourceNote),
    ];
    await tx.run(
      `INSERT INTO tax_assumptions (is_rate_bp, is_minimum_minor, is_override_minor, is_paid_outside_minor, withholding_rate_bp,
         legal_reserve_rate_bp, tva_collected_minor, tva_deductible_minor, pre_tracking_revenue_minor, pre_tracking_expenses_minor,
         retained_earnings_minor, source_note, id, fiscal_year_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fiscal_year_id) DO UPDATE SET
         is_rate_bp = excluded.is_rate_bp, is_minimum_minor = excluded.is_minimum_minor,
         is_override_minor = excluded.is_override_minor, is_paid_outside_minor = excluded.is_paid_outside_minor,
         withholding_rate_bp = excluded.withholding_rate_bp, legal_reserve_rate_bp = excluded.legal_reserve_rate_bp,
         tva_collected_minor = excluded.tva_collected_minor, tva_deductible_minor = excluded.tva_deductible_minor,
         pre_tracking_revenue_minor = excluded.pre_tracking_revenue_minor,
         pre_tracking_expenses_minor = excluded.pre_tracking_expenses_minor,
         retained_earnings_minor = excluded.retained_earnings_minor, source_note = excluded.source_note,
         updated_at = excluded.updated_at`,
      [...values, newId(), fiscalYearId, ts, ts],
    );
  });
}

type TaxItemRow = {
  id: string;
  fiscal_year_id: string;
  kind: TaxItemKind;
  label: string;
  amount_minor: number | null;
  rate_bp: number | null;
  base: TaxItem['base'];
  source_note: string | null;
};

export async function listTaxItems(db: Db, fiscalYearId: string): Promise<TaxItem[]> {
  const rows = await db.all<TaxItemRow>('SELECT * FROM tax_items WHERE fiscal_year_id = ? ORDER BY sort_order, created_at', [
    fiscalYearId,
  ]);
  return rows.map((r) => ({
    id: r.id,
    fiscalYearId: r.fiscal_year_id,
    kind: r.kind,
    label: r.label,
    amountMinor: r.amount_minor,
    rateBp: r.rate_bp,
    base: r.base,
    sourceNote: r.source_note,
  }));
}

export type TaxItemInput = Omit<TaxItem, 'id'>;

export async function saveTaxItem(db: Db, input: TaxItemInput, id: string | null = null): Promise<string> {
  if (!clean(input.label)) throw new LedgerError('Describe the item.');
  if (input.kind === 'adjustment') {
    if (input.amountMinor === null || input.amountMinor === 0) throw new LedgerError('Enter the adjustment amount (negative for a deduction).');
    assertMinor(input.amountMinor, 'Amount', { signed: true });
    if (input.rateBp !== null) throw new LedgerError('An adjustment is an amount, not a rate.');
  } else if (input.rateBp !== null) {
    assertBp(input.rateBp, 'The rate');
    if (!input.base) throw new LedgerError('Choose what the rate applies to.');
    if (input.amountMinor !== null) throw new LedgerError('Enter either an amount or a rate, not both.');
  } else {
    if (input.amountMinor === null) throw new LedgerError('Enter an amount or a rate.');
    assertMinor(input.amountMinor, 'Amount');
  }
  return db.transaction(async (tx) => {
    await requireFiscalYear(tx, input.fiscalYearId);
    const ts = nowISO();
    const values: BindValue[] = [
      input.kind,
      input.label.trim(),
      input.amountMinor,
      input.rateBp,
      input.kind === 'other_tax' && input.rateBp !== null ? input.base : null,
      clean(input.sourceNote),
    ];
    if (id) {
      const r = await tx.run(
        `UPDATE tax_items SET kind = ?, label = ?, amount_minor = ?, rate_bp = ?, base = ?, source_note = ?, updated_at = ?
         WHERE id = ? AND fiscal_year_id = ?`,
        [...values, ts, id, input.fiscalYearId],
      );
      if (r.changes === 0) throw new LedgerError('Item not found.');
      return id;
    }
    const itemId = newId();
    await tx.run(
      `INSERT INTO tax_items (kind, label, amount_minor, rate_bp, base, source_note, id, fiscal_year_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tax_items WHERE fiscal_year_id = ?), ?, ?)`,
      [...values, itemId, input.fiscalYearId, input.fiscalYearId, ts, ts],
    );
    return itemId;
  });
}

export async function deleteTaxItem(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM tax_items WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Reserves. Profit reserves (legal/statutory) reduce a year's distributable
// profit; cash reserves reduce the company's liquidity. Neither moves money.

type ReserveRow = {
  id: string;
  company_id: string;
  fiscal_year_id: string | null;
  kind: ReserveKind;
  name: string;
  amount_minor: number;
  notes: string | null;
};

export async function listReserves(db: Db, companyId: string): Promise<CompanyReserve[]> {
  const rows = await db.all<ReserveRow>('SELECT * FROM company_reserves WHERE company_id = ? ORDER BY kind, created_at', [companyId]);
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    fiscalYearId: r.fiscal_year_id,
    kind: r.kind,
    name: r.name,
    amountMinor: r.amount_minor,
    notes: r.notes,
  }));
}

export type ReserveInput = Omit<CompanyReserve, 'id'>;

export async function saveReserve(db: Db, input: ReserveInput, id: string | null = null): Promise<string> {
  if (!clean(input.name)) throw new LedgerError('Give the reserve a name.');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new LedgerError('Amount must be greater than zero.');
  if (input.kind !== 'cash' && !input.fiscalYearId) throw new LedgerError('A profit reserve belongs to a fiscal year. Choose one.');
  return db.transaction(async (tx) => {
    await requireCompany(tx, input.companyId);
    const fyId = input.kind === 'cash' ? null : input.fiscalYearId;
    if (fyId) {
      const fy = await requireFiscalYear(tx, fyId);
      if (fy.companyId !== input.companyId) throw new LedgerError('That fiscal year belongs to another company.');
    }
    const ts = nowISO();
    if (id) {
      const r = await tx.run(
        `UPDATE company_reserves SET fiscal_year_id = ?, kind = ?, name = ?, amount_minor = ?, notes = ?, updated_at = ?
         WHERE id = ? AND company_id = ?`,
        [fyId, input.kind, input.name.trim(), input.amountMinor, clean(input.notes), ts, id, input.companyId],
      );
      if (r.changes === 0) throw new LedgerError('Reserve not found.');
      return id;
    }
    const reserveId = newId();
    await tx.run(
      `INSERT INTO company_reserves (id, company_id, fiscal_year_id, kind, name, amount_minor, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reserveId, input.companyId, fyId, input.kind, input.name.trim(), input.amountMinor, clean(input.notes), ts, ts],
    );
    return reserveId;
  });
}

export async function deleteReserve(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM company_reserves WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// P&L

/** Expense categories that are not P&L costs, with the reason shown to the user. */
export const PNL_EXCLUDED_EXPENSE_CATEGORIES: Record<string, string> = {
  [SYSTEM_CATEGORY.companyIs]: 'Corporate tax (IS) is the tax on the profit, not a cost before it',
  [SYSTEM_CATEGORY.companyTva]: 'TVA paid to the state was collected for it, not a company cost',
  [SYSTEM_CATEGORY.companyWithholding]: 'Dividend withholding is part of a profit distribution',
  [SYSTEM_CATEGORY.companyDividendsOther]: 'Dividends share out profit; they are not a cost',
  [SYSTEM_CATEGORY.companyLoanPrincipal]: 'Repaying loan principal returns borrowed money',
};

export const PNL_EXCLUDED_INCOME_CATEGORIES: Record<string, string> = {
  [SYSTEM_CATEGORY.companyFinancing]: 'Capital, loans and refunds received are not revenue',
};

/** Company → you transfers that are company costs (and personal income/refunds on your side). */
export const PNL_EXPENSE_TRANSFER_CLASSES: Partial<Record<TransferClass, string>> = {
  salary: 'Salaries paid to you (transfers)',
  expense_reimbursement: 'Expenses reimbursed to you (transfers)',
};

const TRANSFER_EXCLUSION: Partial<Record<TransferClass, string>> = {
  dividend: 'Dividends share out profit; they are not a cost',
  owner_loan: "Owner's current account / loans are borrowed or lent money",
  loan_repayment: 'Loan repayments return borrowed money',
  capital_contribution: 'Capital contributions are equity, not revenue',
  other: 'Other transfers are not classified as revenue or expense — check them',
  internal: 'Transfers between companies are not revenue or expense',
};

export function excludedReason(f: Pick<ExpenseFact, 'topId' | 'categoryId'>, kind: 'expense' | 'income'): string | null {
  const map = kind === 'expense' ? PNL_EXCLUDED_EXPENSE_CATEGORIES : PNL_EXCLUDED_INCOME_CATEGORIES;
  return map[f.topId ?? ''] ?? map[f.categoryId ?? ''] ?? null;
}

export type TransferFact = {
  id: string;
  date: string;
  /** Company-side amount in MAD (what left or entered the company). */
  amountMinor: number;
  transferClass: TransferClass;
  direction: 'out' | 'in';
  counterparty: string;
};

export type PnlGroup = {
  key: string;
  label: string;
  reason: string;
  amountMinor: number;
  count: number;
  drill: TransactionFilter;
};

export type CompanyPnl = {
  companyId: string;
  range: DateRange;
  revenue: { totalMinor: number; facts: ExpenseFact[]; tags: ExpenseFacts['tags'] };
  /** Recorded P&L expenses (expense transactions) — the facts the breakdowns use. */
  expenses: { totalMinor: number; facts: ExpenseFact[]; tags: ExpenseFacts['tags'] };
  /** Salary and reimbursement transfers to you, counted as costs. */
  expenseTransfers: { totalMinor: number; facts: TransferFact[]; groups: PnlGroup[] };
  /** All P&L costs: expenses + expense transfers. */
  costsMinor: number;
  /** Revenue − costs, as recorded (TTC for TTC companies), before tax. */
  profitMinor: number;
  /** Movements that are deliberately not revenue or cost. */
  excluded: PnlGroup[];
  adjustments: { totalMinor: number; count: number; drill: TransactionFilter };
  unconvertedCurrencies: string[];
};

/** Pure: classifies company movements into the P&L. */
export function computePnl(input: {
  companyId: string;
  range: DateRange;
  expenses: ExpenseFacts;
  income: ExpenseFacts;
  transfers: TransferFact[];
  adjustments: { totalMinor: number; count: number };
}): CompanyPnl {
  const { companyId, range } = input;
  const scope = { from: range.from, to: range.to, companyId };
  const excluded = new Map<string, PnlGroup>();
  const exclude = (key: string, make: () => Omit<PnlGroup, 'amountMinor' | 'count'>, amount: number) => {
    const g = excluded.get(key) ?? { ...make(), amountMinor: 0, count: 0 };
    g.amountMinor += amount;
    g.count += 1;
    excluded.set(key, g);
  };

  const expenseFacts: ExpenseFact[] = [];
  for (const f of input.expenses.facts) {
    const reason = excludedReason(f, 'expense');
    if (!reason) {
      expenseFacts.push(f);
      continue;
    }
    const catId = PNL_EXCLUDED_EXPENSE_CATEGORIES[f.topId ?? ''] ? f.topId! : f.categoryId!;
    exclude(
      `cat:${catId}`,
      () => ({
        key: `cat:${catId}`,
        label: (catId === f.topId ? f.topName : f.categoryName) ?? 'Excluded',
        reason,
        drill: { ...scope, kinds: ['expense'], categoryId: catId, includeSubcategories: true },
      }),
      f.amountMinor,
    );
  }

  const revenueFacts: ExpenseFact[] = [];
  for (const f of input.income.facts) {
    const reason = excludedReason(f, 'income');
    if (!reason) {
      revenueFacts.push(f);
      continue;
    }
    const catId = PNL_EXCLUDED_INCOME_CATEGORIES[f.topId ?? ''] ? f.topId! : f.categoryId!;
    exclude(
      `cat:${catId}`,
      () => ({
        key: `cat:${catId}`,
        label: (catId === f.topId ? f.topName : f.categoryName) ?? 'Excluded',
        reason,
        drill: { ...scope, kinds: ['income'], categoryId: catId, includeSubcategories: true },
      }),
      f.amountMinor,
    );
  }

  const transferFacts: TransferFact[] = [];
  const transferGroups = new Map<string, PnlGroup>();
  for (const t of input.transfers) {
    const costLabel = t.direction === 'out' ? PNL_EXPENSE_TRANSFER_CLASSES[t.transferClass] : undefined;
    if (costLabel) {
      transferFacts.push(t);
      const g = transferGroups.get(t.transferClass) ?? {
        key: t.transferClass,
        label: costLabel,
        reason: 'A company cost; on your side it is personal income or a refund',
        amountMinor: 0,
        count: 0,
        drill: { ...scope, kinds: ['transfer'], transferClass: t.transferClass },
      };
      g.amountMinor += t.amountMinor;
      g.count += 1;
      transferGroups.set(t.transferClass, g);
      continue;
    }
    const key = `transfer:${t.transferClass}:${t.direction}`;
    exclude(
      key,
      () => ({
        key,
        label: `${t.direction === 'out' ? 'Out' : 'In'}: ${transferLabel(t.transferClass)}`,
        reason: TRANSFER_EXCLUSION[t.transferClass] ?? 'Not revenue or expense',
        drill: { ...scope, kinds: ['transfer'], transferClass: t.transferClass },
      }),
      t.amountMinor,
    );
  }

  const revenue = revenueFacts.reduce((s, f) => s + f.amountMinor, 0);
  const expenses = expenseFacts.reduce((s, f) => s + f.amountMinor, 0);
  const transfersCost = transferFacts.reduce((s, t) => s + t.amountMinor, 0);
  return {
    companyId,
    range,
    revenue: { totalMinor: revenue, facts: revenueFacts, tags: input.income.tags },
    expenses: { totalMinor: expenses, facts: expenseFacts, tags: input.expenses.tags },
    expenseTransfers: { totalMinor: transfersCost, facts: transferFacts, groups: [...transferGroups.values()] },
    costsMinor: expenses + transfersCost,
    profitMinor: revenue - expenses - transfersCost,
    excluded: [...excluded.values()].sort((a, b) => b.amountMinor - a.amountMinor),
    adjustments: { ...input.adjustments, drill: { ...scope, kinds: ['adjustment'] } },
    unconvertedCurrencies: [...new Set([...input.expenses.unconvertedCurrencies, ...input.income.unconvertedCurrencies])],
  };
}

function transferLabel(c: TransferClass): string {
  switch (c) {
    case 'dividend':
      return 'dividends';
    case 'owner_loan':
      return "owner's current account / loans";
    case 'loan_repayment':
      return 'loan repayments';
    case 'capital_contribution':
      return 'capital';
    case 'internal':
      return 'other companies';
    default:
      return 'other transfers';
  }
}

/** Transfers between this company and anything outside it (internal moves are skipped). */
export async function loadCompanyTransfers(db: Db, companyId: string, range: DateRange): Promise<{ facts: TransferFact[]; unconverted: string[] }> {
  const today = todayISO();
  const rates = await latestRates(db, range.to < today ? range.to : today);
  const rows = await db.all<{
    id: string;
    date: string;
    transfer_class: TransferClass | null;
    from_amount: number;
    from_cur: string;
    from_co: string | null;
    from_name: string;
    to_amount: number;
    to_cur: string;
    to_co: string | null;
    to_name: string;
  }>(
    `SELECT t.id, t.date, t.transfer_class,
       pf.amount_minor AS from_amount, af.currency AS from_cur, af.company_id AS from_co, af.name AS from_name,
       pt.amount_minor AS to_amount, at2.currency AS to_cur, at2.company_id AS to_co, at2.name AS to_name
     FROM transactions t
     JOIN postings pf ON pf.transaction_id = t.id AND pf.role = 'from'
     JOIN accounts af ON af.id = pf.account_id
     JOIN postings pt ON pt.transaction_id = t.id AND pt.role = 'to'
     JOIN accounts at2 ON at2.id = pt.account_id
     WHERE t.deleted_at IS NULL AND t.kind = 'transfer' AND t.date BETWEEN ? AND ?
       AND (af.company_id = ? OR at2.company_id = ?)
     ORDER BY t.date, t.created_at`,
    [range.from, range.to, companyId, companyId],
  );
  const unconverted = new Set<string>();
  const facts: TransferFact[] = [];
  for (const r of rows) {
    const out = r.from_co === companyId;
    const into = r.to_co === companyId;
    if (out && into) continue;
    const amount = out ? convertToBase(-r.from_amount, r.from_cur, rates) : convertToBase(r.to_amount, r.to_cur, rates);
    if (amount === null) {
      unconverted.add(out ? r.from_cur : r.to_cur);
      continue;
    }
    facts.push({
      id: r.id,
      date: r.date,
      amountMinor: amount,
      transferClass: r.transfer_class ?? 'internal',
      direction: out ? 'out' : 'in',
      counterparty: out ? r.to_name : r.from_name,
    });
  }
  return { facts, unconverted: [...unconverted] };
}

export async function loadCompanyPnl(db: Db, companyId: string, range: DateRange): Promise<CompanyPnl> {
  const [expenses, income, transfers, adj] = await Promise.all([
    loadExpenseFacts(db, range, 'business', { companyId }),
    loadExpenseFacts(db, range, 'business', { companyId, kind: 'income' }),
    loadCompanyTransfers(db, companyId, range),
    db.all<{ currency: string; total: number; n: number }>(
      `SELECT a.currency, SUM(p.amount_minor) AS total, COUNT(*) AS n
       FROM transactions t JOIN postings p ON p.transaction_id = t.id JOIN accounts a ON a.id = p.account_id
       WHERE t.deleted_at IS NULL AND t.kind = 'adjustment' AND a.company_id = ? AND t.date BETWEEN ? AND ?
       GROUP BY a.currency`,
      [companyId, range.from, range.to],
    ),
  ]);
  const rates = await latestRates(db, range.to < todayISO() ? range.to : todayISO());
  let adjTotal = 0;
  let adjCount = 0;
  for (const a of adj) {
    adjTotal += convertToBase(a.total, a.currency, rates) ?? 0;
    adjCount += a.n;
  }
  const pnl = computePnl({ companyId, range, expenses, income, transfers: transfers.facts, adjustments: { totalMinor: adjTotal, count: adjCount } });
  pnl.unconvertedCurrencies = [...new Set([...pnl.unconvertedCurrencies, ...transfers.unconverted])];
  return pnl;
}

// ---------------------------------------------------------------------------
// Data sufficiency: accounting profit is only shown when the year is covered.

export type DataStatus = {
  /** Some revenue or cost was recorded (or entered) for the year. */
  hasData: boolean;
  /** Enough data for an accounting profit: hasData and no gaps. */
  complete: boolean;
  /** Why the figures are incomplete, in plain words. */
  reasons: string[];
  /** The year has not ended yet. */
  yearToDate: boolean;
};

export function dataStatus(input: {
  fiscalYear: FiscalYear;
  company: Company;
  assumptions: TaxAssumptions;
  pnl: CompanyPnl;
  accounts: { name: string; openingDate: string }[];
  today?: string;
}): DataStatus {
  const { fiscalYear: fy, company, assumptions: a, pnl } = input;
  const today = input.today ?? todayISO();
  const reasons: string[] = [];
  const preTracking = a.preTrackingRevenueMinor !== null || a.preTrackingExpensesMinor !== null;
  const recorded = pnl.revenue.facts.length + pnl.expenses.facts.length + pnl.expenseTransfers.facts.length > 0;
  const hasData = recorded || preTracking;

  if (input.accounts.length === 0) reasons.push('The company has no money locations yet.');
  const late = input.accounts.filter((x) => x.openingDate > fy.startDate && x.openingDate <= fy.endDate);
  if (late.length > 0 && !preTracking) {
    reasons.push(
      `${late.map((x) => `${x.name} starts on ${formatDateLabel(x.openingDate, today)}`).join(', ')}: earlier activity is only in the opening balance. Enter the revenue and expenses before tracking in the assumptions.`,
    );
  }
  if (company.tvaMode === 'ttc') {
    if (pnl.revenue.totalMinor > 0 && a.tvaCollectedMinor === null) {
      reasons.push('Revenue is recorded TVA included (TTC), but the TVA collected for this year is not entered.');
    }
    if (pnl.expenses.totalMinor > 0 && a.tvaDeductibleMinor === null) {
      reasons.push('Expenses are recorded TVA included (TTC), but the deductible TVA for this year is not entered.');
    }
  }
  if (pnl.unconvertedCurrencies.length > 0) {
    reasons.push(`Activity in ${pnl.unconvertedCurrencies.join(', ')} has no exchange rate and is left out.`);
  }
  if (!hasData) reasons.unshift('No revenue or expenses are recorded for this fiscal year yet.');
  return { hasData, complete: hasData && reasons.length === 0, reasons, yearToDate: fy.endDate > today };
}

// ---------------------------------------------------------------------------
// Tax estimate (pure). Every step shows where its figure comes from.

export type EstimateStep = {
  key: string;
  label: string;
  /** Null when a required input is missing. */
  amountMinor: number | null;
  source: 'recorded' | 'entered' | 'computed';
  calculation: string;
  drill?: TransactionFilter;
  /** A headline figure (profit, IS, distributable…). */
  result?: boolean;
};

export type TaxEstimate = {
  revenueHtMinor: number;
  costsHtMinor: number;
  /** Accounting profit before tax (HT). */
  accountingProfitMinor: number;
  taxableProfitMinor: number;
  isEstimatedMinor: number | null;
  isAdvancesMinor: number;
  /** IS still to pay; negative when more was paid than estimated. */
  isRemainingMinor: number | null;
  otherTaxesMinor: number;
  profitAfterTaxMinor: number | null;
  profitReservesMinor: number;
  distributableMinor: number | null;
  approvedMinor: number;
  remainingDistributableMinor: number | null;
  steps: EstimateStep[];
  /** Inputs to enter before the estimate is complete. */
  missing: string[];
};

export function computeTaxEstimate(input: {
  company: Company;
  fiscalYear: FiscalYear;
  assumptions: TaxAssumptions;
  items: TaxItem[];
  pnl: Pick<CompanyPnl, 'revenue' | 'expenses' | 'expenseTransfers' | 'costsMinor'>;
  /** Σ payments linked to this year's IS obligations. */
  isLinkedPaymentsMinor: number;
  /** Legal / statutory reserves recorded for this year. */
  profitReserves: CompanyReserve[];
  /** Σ total gross of approved (not cancelled) distributions out of this year's profit. */
  approvedGrossMinor: number;
}): TaxEstimate {
  const { company, assumptions: a, pnl } = input;
  const fmt = (v: number) => formatMoney(v);
  const steps: EstimateStep[] = [];
  const missing: string[] = [];
  const ttc = company.tvaMode === 'ttc';
  const scope: TransactionFilter = { from: input.fiscalYear.startDate, to: input.fiscalYear.endDate, companyId: company.id };

  // 1–2. Revenue
  const tvaCollected = ttc ? (a.tvaCollectedMinor ?? 0) : 0;
  const preRevenue = a.preTrackingRevenueMinor ?? 0;
  steps.push({
    key: 'revenue',
    label: ttc ? 'Revenue recorded (TVA included)' : 'Revenue recorded',
    amountMinor: pnl.revenue.totalMinor,
    source: 'recorded',
    calculation: `Sum of ${pnl.revenue.facts.length} income transaction${pnl.revenue.facts.length === 1 ? '' : 's'} on the company's accounts in this fiscal year, excluding capital, loans and refunds.`,
    drill: { ...scope, kinds: ['income'] },
  });
  if (ttc) {
    steps.push({
      key: 'tva-collected',
      label: '− TVA collected (included above)',
      amountMinor: a.tvaCollectedMinor === null ? null : -tvaCollected,
      source: 'entered',
      calculation:
        a.tvaCollectedMinor === null
          ? 'Not entered. Take it from your TVA returns for the year; it belongs to the state, not to the company.'
          : 'Entered by you, from your TVA returns.',
    });
    if (a.tvaCollectedMinor === null && pnl.revenue.totalMinor > 0) missing.push('TVA collected for this year');
  }
  if (a.preTrackingRevenueMinor !== null) {
    steps.push({ key: 'pre-revenue', label: '+ Revenue before tracking (HT)', amountMinor: preRevenue, source: 'entered', calculation: 'Entered by you for the part of the year before the company accounts were tracked here.' });
  }
  const revenueHt = pnl.revenue.totalMinor - tvaCollected + preRevenue;
  steps.push({
    key: 'revenue-ht',
    label: 'Revenue (HT)',
    amountMinor: revenueHt,
    source: 'computed',
    calculation: `${fmt(pnl.revenue.totalMinor)}${ttc ? ` − ${fmt(tvaCollected)} TVA` : ''}${preRevenue ? ` + ${fmt(preRevenue)} before tracking` : ''}.`,
  });

  // 3. Deductible costs
  const tvaDeductible = ttc ? (a.tvaDeductibleMinor ?? 0) : 0;
  const preCosts = a.preTrackingExpensesMinor ?? 0;
  steps.push({
    key: 'costs',
    label: ttc ? 'Expenses recorded (TVA included)' : 'Expenses recorded',
    amountMinor: pnl.costsMinor,
    source: 'recorded',
    calculation: `${fmt(pnl.expenses.totalMinor)} in ${pnl.expenses.facts.length} expense${pnl.expenses.facts.length === 1 ? '' : 's'}${pnl.expenseTransfers.totalMinor ? ` + ${fmt(pnl.expenseTransfers.totalMinor)} salaries/reimbursements transferred to you` : ''}. IS, TVA paid, dividends, withholding and loan principal are not costs and are left out.`,
    drill: { ...scope, kinds: ['expense'] },
  });
  if (ttc) {
    steps.push({
      key: 'tva-deductible',
      label: '− Deductible TVA (included above)',
      amountMinor: a.tvaDeductibleMinor === null ? null : -tvaDeductible,
      source: 'entered',
      calculation:
        a.tvaDeductibleMinor === null
          ? 'Not entered. Take it from your TVA returns; recoverable TVA is not a cost.'
          : 'Entered by you, from your TVA returns.',
    });
    if (a.tvaDeductibleMinor === null && pnl.costsMinor > 0) missing.push('Deductible TVA for this year');
  }
  if (a.preTrackingExpensesMinor !== null) {
    steps.push({ key: 'pre-costs', label: '+ Expenses before tracking (HT)', amountMinor: preCosts, source: 'entered', calculation: 'Entered by you for the part of the year before the company accounts were tracked here.' });
  }
  const costsHt = pnl.costsMinor - tvaDeductible + preCosts;
  steps.push({
    key: 'costs-ht',
    label: 'Deductible expenses (HT)',
    amountMinor: costsHt,
    source: 'computed',
    calculation: `${fmt(pnl.costsMinor)}${ttc ? ` − ${fmt(tvaDeductible)} TVA` : ''}${preCosts ? ` + ${fmt(preCosts)} before tracking` : ''}.`,
  });

  // 4. Accounting profit
  const profit = revenueHt - costsHt;
  steps.push({
    key: 'profit',
    label: 'Accounting profit before tax',
    amountMinor: profit,
    source: 'computed',
    calculation: `Revenue ${fmt(revenueHt)} − expenses ${fmt(costsHt)}. Cash basis: from recorded payments, not invoices; your accountant's figure may differ.`,
    result: true,
  });

  // 5–6. Taxable profit
  const adjustments = input.items.filter((i) => i.kind === 'adjustment');
  const adjTotal = adjustments.reduce((s, i) => s + (i.amountMinor ?? 0), 0);
  if (adjustments.length > 0) {
    steps.push({
      key: 'adjustments',
      label: 'Taxable-profit adjustments',
      amountMinor: adjTotal,
      source: 'entered',
      calculation: adjustments.map((i) => `${i.label}: ${formatMoney(i.amountMinor ?? 0, BASE_CURRENCY, { sign: 'always' })}`).join('; ') + '.',
    });
  }
  const taxable = profit + adjTotal;
  steps.push({
    key: 'taxable',
    label: 'Taxable profit (estimated)',
    amountMinor: taxable,
    source: 'computed',
    calculation:
      `${fmt(profit)}${adjustments.length ? ` ${adjTotal < 0 ? '−' : '+'} ${fmt(Math.abs(adjTotal))} adjustments` : ''}` +
      (taxable < 0 ? '. A tax loss: no IS is due on profit.' : '.'),
  });

  // 7. IS
  let isEstimated: number | null = null;
  if (a.isOverrideMinor !== null) {
    isEstimated = a.isOverrideMinor;
    steps.push({ key: 'is', label: 'Corporate tax (IS)', amountMinor: isEstimated, source: 'entered', calculation: 'Amount entered by you (replaces the calculation).', result: true });
  } else if (a.isRateBp !== null) {
    const byRate = applyBp(Math.max(0, taxable), a.isRateBp);
    isEstimated = Math.max(byRate, a.isMinimumMinor ?? 0);
    const minimumApplies = a.isMinimumMinor !== null && a.isMinimumMinor > byRate;
    steps.push({
      key: 'is',
      label: 'Corporate tax (IS), estimated',
      amountMinor: isEstimated,
      source: 'computed',
      calculation:
        `${fmt(Math.max(0, taxable))} × ${formatBp(a.isRateBp)} (your rate) = ${fmt(byRate)}` +
        (a.isMinimumMinor !== null ? `; minimum entered ${fmt(a.isMinimumMinor)}${minimumApplies ? ', which applies' : ''}` : '') +
        '. One rate on the whole taxable profit: if your year uses brackets, enter the effective rate or the amount.',
      result: true,
    });
  } else {
    steps.push({ key: 'is', label: 'Corporate tax (IS)', amountMinor: null, source: 'entered', calculation: 'Enter the IS rate that applies to this fiscal year (with its source), or the IS amount.', result: true });
    missing.push('IS rate for this fiscal year');
  }

  // 8–9. Advances and remaining IS
  const advances = input.isLinkedPaymentsMinor + a.isPaidOutsideMinor;
  steps.push({
    key: 'advances',
    label: '− IS already paid (advances)',
    amountMinor: -advances,
    source: a.isPaidOutsideMinor ? 'entered' : 'recorded',
    calculation: `${fmt(input.isLinkedPaymentsMinor)} paid against this year's IS obligations${a.isPaidOutsideMinor ? ` + ${fmt(a.isPaidOutsideMinor)} paid outside the app (entered)` : ''}.`,
  });
  const isRemaining = isEstimated === null ? null : isEstimated - advances;
  steps.push({
    key: 'is-remaining',
    label: isRemaining !== null && isRemaining < 0 ? 'IS paid in excess (credit)' : 'IS still to pay',
    amountMinor: isRemaining,
    source: 'computed',
    calculation: isEstimated === null ? 'Needs the IS estimate.' : `${fmt(isEstimated)} − ${fmt(advances)}.`,
  });

  // Other configurable taxes
  const otherTaxes = input.items
    .filter((i) => i.kind === 'other_tax')
    .map((i) => {
      if (i.rateBp !== null) {
        const base = i.base === 'revenue' ? Math.max(0, revenueHt) : Math.max(0, taxable);
        return { item: i, amount: applyBp(base, i.rateBp), calc: `${fmt(base)} ${i.base === 'revenue' ? 'revenue' : 'taxable profit'} × ${formatBp(i.rateBp)}` };
      }
      return { item: i, amount: i.amountMinor ?? 0, calc: 'amount entered' };
    });
  const otherTotal = otherTaxes.reduce((s, x) => s + x.amount, 0);
  if (otherTaxes.length > 0) {
    steps.push({
      key: 'other-taxes',
      label: '− Other taxes (estimated)',
      amountMinor: -otherTotal,
      source: 'entered',
      calculation: otherTaxes.map((x) => `${x.item.label}: ${fmt(x.amount)} (${x.calc})`).join('; ') + '.',
    });
  }

  // 10. Profit after tax
  const afterTax = isEstimated === null ? null : profit - isEstimated - otherTotal;
  steps.push({
    key: 'after-tax',
    label: 'Profit after tax',
    amountMinor: afterTax,
    source: 'computed',
    calculation: isEstimated === null ? 'Needs the IS estimate.' : `${fmt(profit)} − ${fmt(isEstimated)} IS${otherTotal ? ` − ${fmt(otherTotal)} other taxes` : ''}.`,
    result: true,
  });

  // 11. Reserves
  const recordedReserves = input.profitReserves.reduce((s, r) => s + r.amountMinor, 0);
  const hasLegal = input.profitReserves.some((r) => r.kind === 'legal');
  let computedLegal = 0;
  if (!hasLegal && a.legalReserveRateBp !== null && afterTax !== null && afterTax > 0) computedLegal = applyBp(afterTax, a.legalReserveRateBp);
  const reserves = recordedReserves + computedLegal;
  steps.push({
    key: 'reserves',
    label: '− Reserves from this year’s profit',
    amountMinor: -reserves,
    source: computedLegal ? 'computed' : 'entered',
    calculation:
      [
        ...input.profitReserves.map((r) => `${r.name}: ${fmt(r.amountMinor)}`),
        computedLegal && afterTax !== null ? `legal reserve ${fmt(afterTax)} × ${formatBp(a.legalReserveRateBp!)} (your rate) = ${fmt(computedLegal)}` : null,
      ]
        .filter(Boolean)
        .join('; ') || 'None entered. Add the legal reserve if the company still has to build it up.',
  });

  // 12. Retained earnings
  if (a.retainedEarningsMinor !== 0) {
    steps.push({
      key: 'retained',
      label: a.retainedEarningsMinor > 0 ? '+ Retained earnings brought forward' : '− Losses carried forward',
      amountMinor: a.retainedEarningsMinor,
      source: 'entered',
      calculation: 'Entered by you. Earlier years count only through this figure, so nothing is counted twice.',
    });
  }

  // 13–15. Distributable profit
  const distributable = afterTax === null ? null : Math.max(0, afterTax - reserves + a.retainedEarningsMinor);
  steps.push({
    key: 'distributable',
    label: 'Estimated distributable profit',
    amountMinor: distributable,
    source: 'computed',
    calculation:
      afterTax === null
        ? 'Needs the profit after tax.'
        : `${fmt(afterTax)} − ${fmt(reserves)} reserves${a.retainedEarningsMinor ? ` ${a.retainedEarningsMinor > 0 ? '+' : '−'} ${fmt(Math.abs(a.retainedEarningsMinor))}` : ''}` +
          (afterTax - reserves + a.retainedEarningsMinor < 0 ? ', below zero: nothing is distributable.' : '.') +
          ' This is profit, not cash: the company must also have the money after its obligations.',
    result: true,
  });
  const remaining = distributable === null ? null : Math.max(0, distributable - input.approvedGrossMinor);
  if (input.approvedGrossMinor > 0) {
    steps.push({
      key: 'remaining',
      label: 'Not yet distributed',
      amountMinor: remaining,
      source: 'computed',
      calculation:
        distributable === null
          ? `${fmt(input.approvedGrossMinor)} already approved; needs the distributable estimate.`
          : `${fmt(distributable)} − ${fmt(input.approvedGrossMinor)} already approved out of this year's profit` +
            (input.approvedGrossMinor > distributable ? ' — more than the estimate!' : '.'),
    });
  }

  return {
    revenueHtMinor: revenueHt,
    costsHtMinor: costsHt,
    accountingProfitMinor: profit,
    taxableProfitMinor: taxable,
    isEstimatedMinor: isEstimated,
    isAdvancesMinor: advances,
    isRemainingMinor: isRemaining,
    otherTaxesMinor: otherTotal,
    profitAfterTaxMinor: afterTax,
    profitReservesMinor: reserves,
    distributableMinor: distributable,
    approvedMinor: input.approvedGrossMinor,
    remainingDistributableMinor: remaining,
    steps,
    missing,
  };
}

export type FiscalYearReport = {
  company: Company;
  fiscalYear: FiscalYear;
  assumptions: TaxAssumptions;
  items: TaxItem[];
  pnl: CompanyPnl;
  status: DataStatus;
  estimate: TaxEstimate;
};

/** Everything about one fiscal year: P&L, data status and tax estimate. */
export async function fiscalYearReport(db: Db, fiscalYearId: string): Promise<FiscalYearReport> {
  const fiscalYear = await requireFiscalYear(db, fiscalYearId);
  const company = await requireCompany(db, fiscalYear.companyId);
  const today = todayISO();
  const range = { from: fiscalYear.startDate, to: fiscalYear.endDate < today ? fiscalYear.endDate : today };
  const [assumptions, items, pnl, reserves, isPaid, approved, accounts] = await Promise.all([
    getTaxAssumptions(db, fiscalYearId),
    listTaxItems(db, fiscalYearId),
    range.from <= range.to
      ? loadCompanyPnl(db, company.id, range)
      : loadCompanyPnl(db, company.id, { from: range.from, to: range.from }),
    listReserves(db, company.id),
    db.first<{ total: number | null }>(
      `SELECT SUM(lp.amount_minor) AS total FROM company_liability_payments lp
       JOIN company_liabilities l ON l.id = lp.liability_id
       JOIN transactions t ON t.id = lp.transaction_id AND t.deleted_at IS NULL
       WHERE l.kind = 'is' AND l.fiscal_year_id = ?`,
      [fiscalYearId],
    ),
    db.first<{ total: number | null }>(
      `SELECT SUM(total_gross_minor) AS total FROM distributions WHERE fiscal_year_id = ? AND status = 'approved'`,
      [fiscalYearId],
    ),
    db.all<{ name: string; opening_date: string }>(
      'SELECT name, opening_date FROM accounts WHERE company_id = ? AND opening_date <= ?',
      [company.id, fiscalYear.endDate],
    ),
  ]);
  const status = dataStatus({
    fiscalYear,
    company,
    assumptions,
    pnl,
    accounts: accounts.map((x) => ({ name: x.name, openingDate: x.opening_date })),
    today,
  });
  const estimate = computeTaxEstimate({
    company,
    fiscalYear,
    assumptions,
    items,
    pnl,
    isLinkedPaymentsMinor: isPaid?.total ?? 0,
    profitReserves: reserves.filter((r) => r.kind !== 'cash' && r.fiscalYearId === fiscalYearId),
    approvedGrossMinor: approved?.total ?? 0,
  });
  return { company, fiscalYear, assumptions, items, pnl, status, estimate };
}
