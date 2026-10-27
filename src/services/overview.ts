/**
 * The SARL dashboard and the three-totals overview.
 *
 * A. Your personal money (personal accounts only).
 * B. Each company's position: its cash, what it owes, what it keeps aside.
 * C. A potential future payout to you: approved-but-unpaid dividends plus an
 *    estimate from distributable profit. Not money yet.
 *
 * The three are different kinds of figures and are never added together.
 * Company money never enters A; only a real dividend or salary transfer does.
 */
import type { Db } from '@/db/types';
import { todayISO } from '@/domain/dates';
import { applyBp, BASE_CURRENCY, formatBp, formatMoney } from '@/domain/money';
import { type Company, type CompanyReserve, type DistributionSimulation, type FiscalYear } from '@/domain/types';
import { listCompanies } from './accounts';
import { moneySummary, type CompanySummary, type MoneySummary } from './balances';
import { currentFiscalYear, fiscalYearReport, listFiscalYears, listReserves, type FiscalYearReport } from './company';
import {
  distributionChecks,
  listDistributions,
  listSimulations,
  unmatchedDividendTransfers,
  type CompanyCheck,
  type Distribution,
} from './distributions';
import { listLiabilities, unlinkedObligationPayments, type Liability } from './obligations';
import type { TransactionFilter } from './queries';

/** Personal income categories that would double count a dividend also recorded as a company transfer. */
const PERSONAL_DIVIDEND_CATEGORIES = ['sys-cat-dividends', 'sys-cat-distributions'];

export type ObligationLine = { key: string; label: string; amountMinor: number; href?: string };

export type CompanyPosition = {
  /** Bank + cash + other company locations (MAD). */
  cashMinor: number;
  bankMinor: number;
  cashOnHandMinor: number;
  /** Recorded obligations still outstanding, incl. approved-unpaid dividends to you and company card debt. */
  obligationsMinor: number;
  obligationLines: ObligationLine[];
  /** Cash set aside (cash reserves). */
  reservedMinor: number;
  /** cash − obligations − reserved. */
  liquidityMinor: number;
};

/** Pure. Paying a linked obligation lowers cash and obligations equally, so liquidity is unchanged. */
export function companyPosition(
  summary: Pick<CompanySummary, 'bank' | 'cash' | 'other' | 'total' | 'liabilities'>,
  liabilities: Liability[],
  distributions: Distribution[],
  reserves: CompanyReserve[],
): CompanyPosition {
  const lines: ObligationLine[] = [];
  const open = liabilities.filter((l) => l.outstandingMinor > 0);
  const byKind = new Map<string, number>();
  for (const l of open) byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + l.outstandingMinor);
  const labels: Record<string, string> = {
    is: 'Corporate tax (IS)',
    tva: 'TVA',
    payroll: 'Payroll',
    cnss: 'CNSS',
    supplier: 'Suppliers',
    withholding: 'Dividend withholding',
    dividend: 'Dividends to other partners',
    other: 'Other obligations',
  };
  for (const [kind, amount] of byKind) lines.push({ key: kind, label: labels[kind] ?? kind, amountMinor: amount });
  const owedToYou = distributions.reduce((s, d) => s + d.outstandingMinor, 0);
  if (owedToYou > 0) lines.push({ key: 'distribution', label: 'Approved dividends to you, not paid yet', amountMinor: owedToYou });
  if (summary.liabilities > 0) lines.push({ key: 'cards', label: 'Company credit cards', amountMinor: summary.liabilities });
  lines.sort((a, b) => b.amountMinor - a.amountMinor);
  const obligations = lines.reduce((s, l) => s + l.amountMinor, 0);
  const reserved = reserves.filter((r) => r.kind === 'cash').reduce((s, r) => s + r.amountMinor, 0);
  return {
    cashMinor: summary.total,
    bankMinor: summary.bank,
    cashOnHandMinor: summary.cash + summary.other,
    obligationsMinor: obligations,
    obligationLines: lines,
    reservedMinor: reserved,
    liquidityMinor: summary.total - obligations - reserved,
  };
}

export type OwnerPayout = {
  /** Net still owed to you on approved distributions (decided, not paid). */
  approvedUnpaidMinor: number;
  /** Estimated net from profit not yet distributed; null when it cannot be estimated. */
  estimatedNetMinor: number | null;
  estimatedGrossMinor: number | null;
  estimatedWithholdingMinor: number | null;
  /** Estimated with the simple mode (an entered share of company money), not from profit and tax. */
  simple: boolean;
  /** Why the estimate is missing or how it was limited. */
  calculation: string[];
  missing: string[];
};

/**
 * Pure. Simple mode: an entered net share of current company money (approved-unpaid dividends
 * included in it, never added twice). Detailed mode: the estimate starts from the profit not yet
 * distributed in the current
 * fiscal year, capped by the cash the company has after its obligations and
 * the IS still to record, then applies your ownership and the withholding rate.
 */
export function ownerPayout(input: {
  company: Company;
  position: CompanyPosition;
  report: FiscalYearReport | null;
  distributions: Distribution[];
  /** Estimated IS not yet recorded as an obligation. */
  unrecordedIsMinor: number;
}): OwnerPayout {
  const { company, position, report } = input;
  const approvedUnpaid = input.distributions.reduce((s, d) => s + d.outstandingMinor, 0);
  const calculation: string[] = [];
  const missing: string[] = [];
  if (approvedUnpaid > 0) calculation.push(`Approved and not yet paid to you: ${formatMoney(approvedUnpaid)} net.`);
  const out = (estimated: Pick<OwnerPayout, 'estimatedNetMinor' | 'estimatedGrossMinor' | 'estimatedWithholdingMinor'> | null): OwnerPayout => ({
    approvedUnpaidMinor: approvedUnpaid,
    estimatedNetMinor: estimated?.estimatedNetMinor ?? null,
    estimatedGrossMinor: estimated?.estimatedGrossMinor ?? null,
    estimatedWithholdingMinor: estimated?.estimatedWithholdingMinor ?? null,
    simple: company.payoutMode === 'simple',
    calculation,
    missing,
  });
  if (company.payoutMode === 'simple') {
    // One entered net share of what the company holds now, with no tax or profit model. Approved
    // dividends not yet paid come out of that same money, so they are part of the share, not extra.
    const bp = company.simplePayoutBp;
    if (bp === null) {
      missing.push('Enter your share of the company money (simple estimate) in Settings.');
      return out(null);
    }
    const share = applyBp(Math.max(0, position.cashMinor), bp);
    const extra = Math.max(0, share - approvedUnpaid);
    calculation.push(
      `Simple estimate: ${formatBp(bp)} of current company money ${formatMoney(position.cashMinor)} = ${formatMoney(share)}, taken as your net share.`,
    );
    if (approvedUnpaid > 0) {
      calculation.push(
        approvedUnpaid >= share
          ? 'The approved dividends not yet paid already cover it, so nothing is added.'
          : `Of that, ${formatMoney(approvedUnpaid)} is already approved; ${formatMoney(extra)} comes on top.`,
      );
    }
    calculation.push('No fiscal year, tax or obligation is used. Switch to the detailed estimate when the accountant figures are available.');
    return out({ estimatedNetMinor: extra, estimatedGrossMinor: null, estimatedWithholdingMinor: null });
  }
  if (!report) {
    missing.push('Create a fiscal year to estimate distributable profit.');
    return out(null);
  }
  if (!report.status.complete) {
    missing.push(...report.status.reasons);
    return out(null);
  }
  const remaining = report.estimate.remainingDistributableMinor;
  if (remaining === null) {
    missing.push(...report.estimate.missing.map((m) => `Enter the ${m}.`));
    return out(null);
  }
  const wbp = report.assumptions.withholdingRateBp;
  if (wbp === null) {
    missing.push(`Enter the dividend withholding rate for ${report.fiscalYear.label}.`);
    return out(null);
  }
  const cash = Math.max(0, position.liquidityMinor - input.unrecordedIsMinor);
  const base = Math.min(remaining, cash);
  const gross = applyBp(base, company.ownershipBp);
  const withholding = applyBp(gross, wbp);
  calculation.push(
    `Profit not yet distributed (${report.fiscalYear.label}): ${formatMoney(remaining)}.`,
    `Cash after obligations${input.unrecordedIsMinor ? ` and ${formatMoney(input.unrecordedIsMinor)} IS still to record` : ''}: ${formatMoney(cash)}.`,
    `The lower of the two: ${formatMoney(base)}${base < remaining ? ' (limited by cash)' : ''}.`,
    `× ${formatBp(company.ownershipBp)} your ownership = ${formatMoney(gross)} gross; − ${formatBp(wbp)} withholding ${formatMoney(withholding)} = ${formatMoney(gross - withholding)} net.`,
  );
  if (report.status.yearToDate) calculation.push('The year is not over: its profit can only be distributed once the accounts are approved.');
  return out({ estimatedNetMinor: gross - withholding, estimatedGrossMinor: gross, estimatedWithholdingMinor: withholding });
}

export type CompanyDashboard = {
  company: Company;
  summary: CompanySummary;
  position: CompanyPosition;
  fiscalYears: FiscalYear[];
  fiscalYear: FiscalYear | null;
  report: FiscalYearReport | null;
  liabilities: Liability[];
  distributions: Distribution[];
  simulations: DistributionSimulation[];
  reserves: CompanyReserve[];
  /** Estimated IS for the current year not yet recorded as an obligation (informational, not subtracted). */
  unrecordedIsMinor: number;
  payout: OwnerPayout;
  checks: CompanyCheck[];
};

const emptySummary = (company: Company): CompanySummary => ({
  company,
  bank: 0,
  cash: 0,
  other: 0,
  total: 0,
  liabilities: 0,
  accounts: [],
  unconverted: [],
});

export async function companyDashboard(db: Db, companyId: string, money?: MoneySummary): Promise<CompanyDashboard | null> {
  const companies = await listCompanies(db);
  const company = companies.find((c) => c.id === companyId);
  if (!company) return null;
  const [summary, fiscalYears, liabilities, distributions, simulations, reserves, unmatched, unlinked] = await Promise.all([
    money ? Promise.resolve(money) : moneySummary(db),
    listFiscalYears(db, companyId),
    listLiabilities(db, { companyId }),
    listDistributions(db, { companyId }),
    listSimulations(db, companyId),
    listReserves(db, companyId),
    unmatchedDividendTransfers(db, companyId),
    unlinkedObligationPayments(db, companyId),
  ]);
  const companySummary = summary.companies.find((c) => c.company.id === companyId) ?? emptySummary(company);
  const live = distributions.filter((d) => d.status !== 'cancelled');
  const position = companyPosition(companySummary, liabilities, live, reserves);
  const fiscalYear = currentFiscalYear(fiscalYears);
  const report = fiscalYear ? await fiscalYearReport(db, fiscalYear.id) : null;

  const isOutstanding = liabilities
    .filter((l) => l.kind === 'is' && l.fiscalYearId === fiscalYear?.id)
    .reduce((s, l) => s + l.outstandingMinor, 0);
  const isRemaining = report?.estimate.isRemainingMinor ?? 0;
  const unrecordedIs = Math.max(0, isRemaining - isOutstanding);
  const payout = ownerPayout({ company, position, report, distributions: live, unrecordedIsMinor: unrecordedIs });

  const checks: CompanyCheck[] = [];
  const overdue = liabilities.filter((l) => l.overdue);
  if (overdue.length > 0) {
    checks.push({
      id: 'overdue',
      tone: 'danger',
      title: `${overdue.length} obligation${overdue.length > 1 ? 's' : ''} overdue: ${formatMoney(overdue.reduce((s, l) => s + l.outstandingMinor, 0))}`,
      detail: overdue.map((l) => `${l.label}: ${formatMoney(l.outstandingMinor, l.currency)}, ${l.daysOverdue} day${l.daysOverdue === 1 ? '' : 's'} late`).join('\n'),
      href: `/company/${companyId}/obligations`,
    });
  }
  const soon = liabilities.filter((l) => l.dueSoon);
  if (soon.length > 0) {
    checks.push({
      id: 'due-soon',
      tone: 'warning',
      title: `${soon.length} obligation${soon.length > 1 ? 's' : ''} due in the next 14 days`,
      detail: soon.map((l) => `${l.label}: ${formatMoney(l.outstandingMinor, l.currency)} by ${l.dueDate}`).join('\n'),
      href: `/company/${companyId}/obligations`,
    });
  }
  if (unlinked.length > 0) {
    const ids = [...new Set(unlinked.map((u) => u.categoryId))];
    checks.push({
      id: 'unlinked-payments',
      tone: 'warning',
      title: `${unlinked.length} tax payment${unlinked.length > 1 ? 's' : ''} not linked to an obligation`,
      detail: `${formatMoney(unlinked.reduce((s, u) => s + u.amountMinor, 0))} in ${[...new Set(unlinked.map((u) => u.categoryName))].join(', ')}. Link each to the obligation it paid: otherwise the obligation still looks unpaid and liquidity counts it twice.`,
      drill: ids.length === 1 ? ({ companyId, kinds: ['expense'], categoryId: ids[0] } as TransactionFilter) : { companyId, kinds: ['expense'] },
    });
  }
  checks.push(...distributionChecks(companyId, distributions, unmatched));
  if (position.liquidityMinor < 0) {
    checks.push({
      id: 'liquidity',
      tone: 'danger',
      title: `Obligations exceed company cash by ${formatMoney(-position.liquidityMinor)}`,
      detail: `Cash ${formatMoney(position.cashMinor)} − obligations ${formatMoney(position.obligationsMinor)} − set aside ${formatMoney(position.reservedMinor)}.`,
    });
  }
  if (unrecordedIs > 0 && fiscalYear) {
    checks.push({
      id: 'is-unrecorded',
      tone: 'info',
      title: `About ${formatMoney(unrecordedIs)} IS for ${fiscalYear.label} is not recorded as an obligation`,
      detail: 'It is an estimate, so it is not subtracted from liquidity. Add it as an obligation when you know the amount and due date.',
      href: `/company/${companyId}/tax`,
    });
  }
  const order = { danger: 0, warning: 1, info: 2 };
  checks.sort((a, b) => order[a.tone] - order[b.tone]);

  return {
    company,
    summary: companySummary,
    position,
    fiscalYears,
    fiscalYear,
    report,
    liabilities,
    distributions,
    simulations,
    reserves,
    unrecordedIsMinor: unrecordedIs,
    payout,
    checks,
  };
}

// ---------------------------------------------------------------------------
// Three totals

export type Scenario = {
  id: string;
  title: string;
  lines: { label: string; beforeMinor: number; afterMinor: number }[];
  note: string;
};

export type ThreeTotals = {
  currency: string;
  /** A. Personal money: personal accounts only. */
  a: { liquidMinor: number; netLiquidMinor: number; unconvertedCount: number };
  /** B. One position per company. Never added to A or C. */
  b: { company: Company; position: CompanyPosition; unconvertedCount: number }[];
  /** C. Potential payout to you, per company. Not money yet. */
  c: {
    approvedUnpaidMinor: number;
    /** Sum of the estimates that could be made; null when none could. */
    estimatedNetMinor: number | null;
    companies: { company: Company; payout: OwnerPayout }[];
  };
  scenarios: Scenario[];
  /** Personal income recorded as dividends (possible double count with a dividend transfer). */
  personalDividendIncome: { count: number; totalMinor: number; drill: TransactionFilter } | null;
};

/** Pure: "if the approved distribution is paid" scenarios. Money moves from B to A; nothing is created. */
export function payoutScenarios(
  a: number,
  companies: { company: Company; position: CompanyPosition; distributions: Distribution[]; latestSimulation: DistributionSimulation | null }[],
  cTotal: number,
): Scenario[] {
  const out: Scenario[] = [];
  for (const co of companies) {
    for (const d of co.distributions) {
      if (d.outstandingMinor <= 0) continue;
      const n = d.outstandingMinor;
      out.push({
        id: `pay-${d.id}`,
        title: `If the approved ${co.company.name}${d.fiscalYearLabel ? ` ${d.fiscalYearLabel}` : ''} distribution is paid (${formatMoney(n)} net)`,
        lines: [
          { label: 'A · Your personal money', beforeMinor: a, afterMinor: a + n },
          { label: `B · ${co.company.name} cash`, beforeMinor: co.position.cashMinor, afterMinor: co.position.cashMinor - n },
          { label: `B · ${co.company.name} liquidity after obligations`, beforeMinor: co.position.liquidityMinor, afterMinor: co.position.liquidityMinor },
          { label: 'C · Potential payout', beforeMinor: cTotal, afterMinor: cTotal - n },
        ],
        note: 'The same money moves from the company to you: A rises by exactly what company cash loses. Liquidity does not change because the payout was already counted as owed.',
      });
    }
    const sim = co.latestSimulation;
    if (sim && sim.netMinor > 0) {
      out.push({
        id: `sim-${sim.id}`,
        title: `If your latest simulation (${formatMoney(sim.proposedMinor)} in total) were approved and fully paid`,
        lines: [
          { label: 'A · Your personal money', beforeMinor: a, afterMinor: a + sim.netMinor },
          { label: `B · ${co.company.name} cash`, beforeMinor: co.position.cashMinor, afterMinor: co.position.cashMinor - sim.proposedMinor },
        ],
        note: `You would receive ${formatMoney(sim.netMinor)} net. The company would also pay ${formatMoney(sim.withholdingMinor)} withholding${sim.proposedMinor - sim.ownerGrossMinor > 0 ? ` and ${formatMoney(sim.proposedMinor - sim.ownerGrossMinor)} to other partners` : ''}. A simulation, not a decision.`,
      });
    }
  }
  return out;
}

export async function threeTotals(db: Db): Promise<ThreeTotals> {
  const money = await moneySummary(db);
  const companies = await listCompanies(db);
  const dashboards = (await Promise.all(companies.map((c) => companyDashboard(db, c.id, money)))).filter(
    (d): d is CompanyDashboard => d !== null && (d.summary.accounts.length > 0 || d.liabilities.length > 0 || d.distributions.length > 0),
  );
  const approvedUnpaid = dashboards.reduce((s, d) => s + d.payout.approvedUnpaidMinor, 0);
  const estimates = dashboards.map((d) => d.payout.estimatedNetMinor).filter((v): v is number => v !== null);
  const estimated = estimates.length ? estimates.reduce((s, v) => s + v, 0) : null;
  const a = money.personal.liquid;
  const cTotal = approvedUnpaid + (estimated ?? 0);

  const today = todayISO();
  const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const div = await db.all<{ category_id: string; n: number; total: number }>(
    `SELECT t.category_id, COUNT(*) AS n, SUM(t.amount_minor) AS total FROM transactions t
     JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     JOIN accounts acc ON acc.id = p.account_id AND acc.ownership = 'personal' AND acc.currency = ?
     WHERE t.deleted_at IS NULL AND t.kind = 'income' AND t.date >= ? AND t.category_id IN (?, ?)
     GROUP BY t.category_id ORDER BY n DESC`,
    [BASE_CURRENCY, from, ...PERSONAL_DIVIDEND_CATEGORIES],
  );

  return {
    currency: BASE_CURRENCY,
    a: { liquidMinor: a, netLiquidMinor: money.personal.netLiquid, unconvertedCount: money.personal.unconverted.length },
    b: dashboards.map((d) => ({ company: d.company, position: d.position, unconvertedCount: d.summary.unconverted.length })),
    c: {
      approvedUnpaidMinor: approvedUnpaid,
      estimatedNetMinor: estimated,
      companies: dashboards.map((d) => ({ company: d.company, payout: d.payout })),
    },
    scenarios: payoutScenarios(
      a,
      dashboards.map((d) => ({
        company: d.company,
        position: d.position,
        distributions: d.distributions.filter((x) => x.status !== 'cancelled'),
        latestSimulation: d.simulations[0] ?? null,
      })),
      cTotal,
    ),
    personalDividendIncome:
      div.length > 0
        ? {
            count: div.reduce((s, x) => s + x.n, 0),
            totalMinor: div.reduce((s, x) => s + x.total, 0),
            drill: { from, to: today, kinds: ['income'], ownership: 'personal', categoryId: div[0].category_id },
          }
        : null,
  };
}
