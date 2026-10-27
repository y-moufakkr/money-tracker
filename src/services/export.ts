import { SCHEMA_VERSION } from '@/db/migrations';
import type { BindValue, Db } from '@/db/types';
import { formatDecimal } from '@/domain/money';
import { PERSONAL_INCOME_TRANSFER_CLASSES, type AccountKind, type Ownership, type TransactionKind, type TransferClass } from '@/domain/types';
import { nowISO } from '@/lib/id';
import { listCompanies } from './accounts';
import { getTaxAssumptions, listFiscalYears } from './company';
import { listDebts } from './debts';
import { listDistributions } from './distributions';
import { listLiabilities } from './obligations';
import { listRules } from './recurring';

/**
 * CSV / JSON export (project.md §24). Every row is one effect of a transaction on one money
 * location, so a row belongs to exactly one side: personal, or one company. A company → personal
 * transfer is two rows, one per side; summing a side's rows never includes the other side's money.
 */

export type ExportScope = 'personal' | 'company' | 'all';

export type ExportFilter = {
  from: string;
  to: string;
  scope: ExportScope;
  /**
   * Categories to include (their subcategories too). Null exports everything, including
   * transfers, balance adjustments and uncategorised entries.
   */
  categoryIds: string[] | null;
  /** With a category selection, also include entries without a category. */
  includeUncategorised?: boolean;
};

export type ExportSide = 'personal' | 'company';

export type ExportEntry = {
  transactionId: string;
  date: string;
  kind: TransactionKind;
  side: ExportSide;
  companyId: string | null;
  companyName: string | null;
  accountId: string;
  accountName: string;
  accountKind: AccountKind;
  /** Signed effect on this location, in its currency (minor units). */
  amountMinor: number;
  currency: string;
  transferClass: TransferClass | null;
  counterpartAccount: string | null;
  counterpartSide: ExportSide | null;
  counterpartCompany: string | null;
  category: string | null;
  parentCategory: string | null;
  merchant: string | null;
  tags: string | null;
  note: string | null;
  itemCount: number;
};

type EntryRow = {
  transaction_id: string;
  date: string;
  kind: TransactionKind;
  ownership: Ownership;
  company_id: string | null;
  company_name: string | null;
  account_id: string;
  account_name: string;
  account_kind: AccountKind;
  amount_minor: number;
  currency: string;
  transfer_class: TransferClass | null;
  cp_account: string | null;
  cp_ownership: Ownership | null;
  cp_company: string | null;
  category: string | null;
  parent_category: string | null;
  merchant: string | null;
  tags: string | null;
  note: string | null;
  item_count: number;
};

const sideOf = (o: Ownership): ExportSide => (o === 'business' ? 'company' : 'personal');

export async function exportEntries(db: Db, f: ExportFilter): Promise<ExportEntry[]> {
  const where = ['t.deleted_at IS NULL', 't.date >= ?', 't.date <= ?'];
  const params: BindValue[] = [f.from, f.to];
  if (f.scope !== 'all') {
    where.push('a.ownership = ?');
    params.push(f.scope === 'company' ? 'business' : 'personal');
  }
  if (f.categoryIds) {
    const ids = f.categoryIds.length ? f.categoryIds : ['__none__'];
    const marks = ids.map(() => '?').join(',');
    where.push(`(t.category_id IN (${marks}) OR c.parent_id IN (${marks})${f.includeUncategorised ? ` OR (t.category_id IS NULL AND t.kind IN ('expense','income'))` : ''})`);
    params.push(...ids, ...ids);
  }
  const rows = await db.all<EntryRow>(
    `SELECT t.id AS transaction_id, t.date, t.kind, a.ownership, a.company_id, co.name AS company_name,
       a.id AS account_id, a.name AS account_name, a.kind AS account_kind, p.amount_minor, a.currency, t.transfer_class,
       ca.name AS cp_account, ca.ownership AS cp_ownership, cco.name AS cp_company,
       c.name AS category, cp.name AS parent_category, m.name AS merchant,
       (SELECT GROUP_CONCAT(g.name, ', ') FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.transaction_id = t.id) AS tags,
       t.note, (SELECT COUNT(*) FROM purchase_items pi WHERE pi.transaction_id = t.id) AS item_count
     FROM postings p
     JOIN transactions t ON t.id = p.transaction_id
     JOIN accounts a ON a.id = p.account_id
     LEFT JOIN companies co ON co.id = a.company_id
     LEFT JOIN postings op ON op.transaction_id = t.id AND op.id <> p.id
     LEFT JOIN accounts ca ON ca.id = op.account_id
     LEFT JOIN companies cco ON cco.id = ca.company_id
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories cp ON cp.id = c.parent_id
     LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE a.ownership WHEN 'personal' THEN 0 ELSE 1 END, co.name, t.date, t.created_at, p.role`,
    params,
  );
  return rows.map((r) => ({
    transactionId: r.transaction_id,
    date: r.date,
    kind: r.kind,
    side: sideOf(r.ownership),
    companyId: r.company_id,
    companyName: r.company_name,
    accountId: r.account_id,
    accountName: r.account_name,
    accountKind: r.account_kind,
    amountMinor: r.amount_minor,
    currency: r.currency,
    transferClass: r.transfer_class,
    counterpartAccount: r.cp_account,
    counterpartSide: r.cp_ownership ? sideOf(r.cp_ownership) : null,
    counterpartCompany: r.cp_company,
    category: r.category,
    parentCategory: r.parent_category,
    merchant: r.merchant,
    tags: r.tags,
    note: r.note,
    itemCount: r.item_count,
  }));
}

// ---------------------------------------------------------------------------
// Totals (per side and currency; nothing is converted or added across sides)

export type ExportTotals = {
  currency: string;
  incomeMinor: number;
  /** Positive. */
  expensesMinor: number;
  transfersInMinor: number;
  /** Positive. */
  transfersOutMinor: number;
  adjustmentsMinor: number;
  /** Loan principal received (borrowed, or repaid to me). Not income. */
  debtInMinor: number;
  /** Loan principal paid out (lent, or repaid by me), positive. Not expense. */
  debtOutMinor: number;
  netChangeMinor: number;
  /** Personal side only: salary and dividend transfers received from a company (already in transfersIn). */
  incomeFromCompanyMinor: number;
};

export function totalsOf(entries: ExportEntry[]): ExportTotals[] {
  const by = new Map<string, ExportTotals>();
  for (const e of entries) {
    let t = by.get(e.currency);
    if (!t) {
      t = {
        currency: e.currency,
        incomeMinor: 0,
        expensesMinor: 0,
        transfersInMinor: 0,
        transfersOutMinor: 0,
        adjustmentsMinor: 0,
        debtInMinor: 0,
        debtOutMinor: 0,
        netChangeMinor: 0,
        incomeFromCompanyMinor: 0,
      };
      by.set(e.currency, t);
    }
    t.netChangeMinor += e.amountMinor;
    if (e.kind === 'income') t.incomeMinor += e.amountMinor;
    else if (e.kind === 'expense') t.expensesMinor -= e.amountMinor;
    else if (e.kind === 'adjustment') t.adjustmentsMinor += e.amountMinor;
    else if (e.kind === 'debt') {
      if (e.amountMinor >= 0) t.debtInMinor += e.amountMinor;
      else t.debtOutMinor -= e.amountMinor;
    } else if (e.amountMinor >= 0) t.transfersInMinor += e.amountMinor;
    else t.transfersOutMinor -= e.amountMinor;
    if (
      e.side === 'personal' &&
      e.kind === 'transfer' &&
      e.amountMinor > 0 &&
      e.counterpartSide === 'company' &&
      e.transferClass &&
      PERSONAL_INCOME_TRANSFER_CLASSES.includes(e.transferClass)
    ) {
      t.incomeFromCompanyMinor += e.amountMinor;
    }
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

// ---------------------------------------------------------------------------
// CSV

export const CSV_COLUMNS = [
  'side',
  'company',
  'date',
  'type',
  'account',
  'account_type',
  'amount',
  'currency',
  'category',
  'parent_category',
  'merchant',
  'transfer_class',
  'counterpart_account',
  'counterpart_side',
  'tags',
  'note',
  'items',
  'transaction_id',
] as const;

/**
 * RFC 4180 quoting. Free text that a spreadsheet would run as a formula (=, +, -, @) is prefixed
 * with an apostrophe; amounts are written by `formatDecimal` and never altered.
 */
export function csvCell(value: string | number | null, text = true): string {
  let s = value === null ? '' : String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(entries: ExportEntry[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of entries) {
    lines.push(
      [
        csvCell(e.side),
        csvCell(e.companyName),
        csvCell(e.date, false),
        csvCell(e.kind),
        csvCell(e.accountName),
        csvCell(e.accountKind),
        csvCell(formatDecimal(e.amountMinor, e.currency), false),
        csvCell(e.currency),
        csvCell(e.category),
        csvCell(e.parentCategory),
        csvCell(e.merchant),
        csvCell(e.transferClass),
        csvCell(e.counterpartAccount),
        csvCell(e.counterpartSide),
        csvCell(e.tags),
        csvCell(e.note),
        csvCell(e.itemCount, false),
        csvCell(e.transactionId, false),
      ].join(','),
    );
  }
  // BOM so spreadsheet apps read accents and Arabic as UTF-8; CRLF per RFC 4180.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// JSON

const money = (minor: number, currency: string) => ({ amount: formatDecimal(minor, currency), amount_minor: minor });

function entryJson(e: ExportEntry) {
  return {
    transaction_id: e.transactionId,
    date: e.date,
    type: e.kind,
    account: e.accountName,
    account_type: e.accountKind,
    ...money(e.amountMinor, e.currency),
    currency: e.currency,
    category: e.category,
    parent_category: e.parentCategory,
    merchant: e.merchant,
    transfer_class: e.transferClass,
    counterpart_account: e.counterpartAccount,
    counterpart_side: e.counterpartSide,
    counterpart_company: e.counterpartCompany,
    tags: e.tags,
    note: e.note,
    items: e.itemCount,
  };
}

function totalsJson(totals: ExportTotals[], personal: boolean) {
  return totals.map((t) => ({
    currency: t.currency,
    income: money(t.incomeMinor, t.currency),
    expenses: money(t.expensesMinor, t.currency),
    transfers_in: money(t.transfersInMinor, t.currency),
    transfers_out: money(t.transfersOutMinor, t.currency),
    adjustments: money(t.adjustmentsMinor, t.currency),
    loan_principal_in: money(t.debtInMinor, t.currency),
    loan_principal_out: money(t.debtOutMinor, t.currency),
    net_change: money(t.netChangeMinor, t.currency),
    ...(personal ? { income_from_company: money(t.incomeFromCompanyMinor, t.currency) } : {}),
  }));
}

const bpJson = (bp: number | null) => (bp === null ? null : { percent: (bp / 100).toFixed(2), bp });

export async function exportJson(db: Db, f: ExportFilter, ctx: { appVersion: string }, entries?: ExportEntry[]) {
  const rows = entries ?? (await exportEntries(db, f));
  const personal = rows.filter((e) => e.side === 'personal');
  const out: Record<string, unknown> = {
    format: 'money-tracker-export',
    format_version: 1,
    exported_at: nowISO(),
    app_version: ctx.appVersion,
    schema_version: SCHEMA_VERSION,
    filters: {
      from: f.from,
      to: f.to,
      scope: f.scope,
      category_ids: f.categoryIds,
      include_uncategorised: f.categoryIds ? !!f.includeUncategorised : null,
    },
    notes: [
      'amount is a decimal string in the entry currency; amount_minor is the same amount as an integer in minor units.',
      'Each entry is the effect of one transaction on one money location. Personal and company money are listed and totalled separately and are never added together.',
      'Totals are per currency; nothing is converted.',
      'type "debt" is loan principal moving in or out (borrowed, lent, repaid). It is never income or expense; interest paid is a separate expense.',
    ],
  };
  if (f.scope !== 'company') {
    out.personal = {
      entries: personal.map(entryJson),
      totals: totalsJson(totalsOf(personal), true),
      debts: (await listDebts(db)).map((d) => ({
        direction: d.direction === 'owe' ? 'I owe' : 'owed to me',
        counterparty: d.counterparty,
        currency: d.currency,
        start_date: d.startDate,
        due_date: d.dueDate,
        principal: money(d.principalMinor, d.currency),
        repaid: money(d.paidMinor, d.currency),
        outstanding: money(d.outstandingMinor, d.currency),
        status: d.status,
        closed_at: d.closedAt,
        repayments: d.payments.map((p) => ({ transaction_id: p.transactionId, date: p.date, type: p.kind, ...money(p.amountMinor, d.currency) })),
      })),
      recurring_payments: (await listRules(db)).map((r) => ({
        name: r.name,
        type: r.direction,
        expected: money(r.amountMinor, r.currency),
        currency: r.currency,
        account: r.accountName,
        category: r.categoryName,
        every: { unit: r.intervalUnit, count: r.intervalCount },
        first_due: r.startDate,
        end_date: r.endDate,
        paused: r.isPaused,
        next_due: r.next?.dueDate ?? null,
      })),
      debt_notes: 'Debts and recurring payments are exported in full (not filtered by date). Expected payments are plans, not money.',
    };
  }
  if (f.scope !== 'personal') {
    const companies = [];
    for (const co of await listCompanies(db)) {
      const own = rows.filter((e) => e.side === 'company' && e.companyId === co.id);
      const years = [];
      for (const fy of await listFiscalYears(db, co.id)) {
        const a = await getTaxAssumptions(db, fy.id);
        years.push({
          label: fy.label,
          start_date: fy.startDate,
          end_date: fy.endDate,
          closed: fy.isClosed,
          assumptions: {
            is_rate: bpJson(a.isRateBp),
            is_minimum: a.isMinimumMinor === null ? null : money(a.isMinimumMinor, co.currency),
            is_override: a.isOverrideMinor === null ? null : money(a.isOverrideMinor, co.currency),
            is_paid_outside_app: money(a.isPaidOutsideMinor, co.currency),
            withholding_rate: bpJson(a.withholdingRateBp),
            legal_reserve_rate: bpJson(a.legalReserveRateBp),
            tva_collected: a.tvaCollectedMinor === null ? null : money(a.tvaCollectedMinor, co.currency),
            tva_deductible: a.tvaDeductibleMinor === null ? null : money(a.tvaDeductibleMinor, co.currency),
            retained_earnings: money(a.retainedEarningsMinor, co.currency),
            source: a.sourceNote,
          },
        });
      }
      companies.push({
        id: co.id,
        name: co.name,
        legal_form: co.legalForm,
        currency: co.currency,
        ownership: bpJson(co.ownershipBp),
        entries: own.map(entryJson),
        totals: totalsJson(totalsOf(own), false),
        fiscal_years: years,
        obligations: (await listLiabilities(db, { companyId: co.id })).map((l) => ({
          kind: l.kind,
          label: l.label,
          due_date: l.dueDate,
          currency: l.currency,
          total: money(l.amountMinor, l.currency),
          paid: money(l.paidMinor, l.currency),
          outstanding: money(l.outstandingMinor, l.currency),
          status: l.status,
        })),
        distributions: (await listDistributions(db, { companyId: co.id })).map((d) => ({
          approved_at: d.approvedAt,
          fiscal_year: d.fiscalYearLabel,
          status: d.stage,
          total_gross: money(d.totalGrossMinor, co.currency),
          your_share: bpJson(d.ownershipBp),
          your_gross: money(d.ownerGrossMinor, co.currency),
          withholding: money(d.withholdingMinor, co.currency),
          your_net: money(d.netMinor, co.currency),
          paid_to_you: money(d.paidMinor, co.currency),
          outstanding: money(d.outstandingMinor, co.currency),
        })),
      });
    }
    out.companies = companies;
    out.company_notes =
      'Company money is not personal money. Obligations, distributions and fiscal-year assumptions are exported in full (not filtered by date or category).';
  }
  return out;
}

export function exportFileName(f: ExportFilter, ext: 'csv' | 'json'): string {
  return `money-tracker-${f.scope}-${f.from}_${f.to}.${ext}`;
}
