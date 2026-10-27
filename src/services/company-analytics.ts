/**
 * Company analytics: P&L breakdowns (reusing the personal breakdown and
 * drill-down machinery on company facts), month-over-month figures and
 * rule-based insights. Every insight states its calculation; none is a guess.
 */
import type { Db } from '@/db/types';
import { addMonths, endOfMonth, formatMonthLabel, startOfMonth, todayISO, type DateRange } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { applyFilter, breakdown, type AnalyticsFilter, type Breakdown, type Dimension } from './analytics';
import { loadCompanyPnl, type CompanyPnl } from './company';
import type { Insight } from './insights';
import type { CompanyDashboard } from './overview';
import type { TransactionFilter } from './queries';

export type MonthFigures = { month: string; revenueMinor: number; costsMinor: number; profitMinor: number };

/** Pure: buckets P&L facts by calendar month (oldest first). */
export function monthlyPnl(pnl: CompanyPnl, months: string[]): MonthFigures[] {
  return months.map((month) => {
    const key = month.slice(0, 7);
    const revenue = pnl.revenue.facts.filter((f) => f.date.startsWith(key)).reduce((s, f) => s + f.amountMinor, 0);
    const costs =
      pnl.expenses.facts.filter((f) => f.date.startsWith(key)).reduce((s, f) => s + f.amountMinor, 0) +
      pnl.expenseTransfers.facts.filter((f) => f.date.startsWith(key)).reduce((s, f) => s + f.amountMinor, 0);
    return { month, revenueMinor: revenue, costsMinor: costs, profitMinor: revenue - costs };
  });
}

/** Breakdown of P&L revenue or costs (expense transactions) with the personal machinery. */
export function pnlBreakdown(pnl: CompanyPnl, side: 'revenue' | 'expenses', dimension: Dimension, filter: AnalyticsFilter | null): Breakdown {
  const src = side === 'revenue' ? pnl.revenue : pnl.expenses;
  return breakdown(applyFilter(src.facts, filter), dimension, src.tags);
}

/** Scope for drill-downs into this company's P&L transactions. */
export function pnlScope(companyId: string, side: 'revenue' | 'expenses'): Partial<TransactionFilter> {
  return { kinds: [side === 'revenue' ? 'income' : 'expense'], ownership: 'business', companyId };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Pure: company insights from the P&L, the last two full months and the dashboard. */
export function companyInsights(input: {
  companyId: string;
  pnl: CompanyPnl;
  monthly: MonthFigures[];
  dashboard: Pick<CompanyDashboard, 'position' | 'liabilities' | 'checks'> | null;
}): Insight[] {
  const { pnl, companyId } = input;
  const out: Insight[] = [];
  const scope = { from: pnl.range.from, to: pnl.range.to, companyId };

  const costs = breakdown(applyFilter(pnl.expenses.facts, null), 'category', pnl.expenses.tags);
  const top = costs.rows[0];
  if (top && pnl.costsMinor > 0) {
    out.push({
      id: 'co-top-cost',
      icon: top.icon ?? 'category',
      tone: 'info',
      title: `${top.label} is ${pct(top.totalMinor / pnl.costsMinor)} of company costs`,
      calculation: `${formatMoney(top.totalMinor)} in ${top.count} expense${top.count > 1 ? 's' : ''} ÷ ${formatMoney(pnl.costsMinor)} total costs (expenses plus salaries/reimbursements transferred to you), ${pnl.range.from} – ${pnl.range.to}.`,
      drill: top.drill ? { ...scope, kinds: ['expense'], ...top.drill } : undefined,
    });
  }
  if (pnl.revenue.totalMinor > 0) {
    const margin = pnl.profitMinor / pnl.revenue.totalMinor;
    out.push({
      id: 'co-margin',
      icon: margin >= 0 ? 'trending_up' : 'trending_down',
      tone: margin >= 0 ? 'positive' : 'warning',
      title: `Recorded margin before tax: ${pct(margin)}`,
      calculation: `(${formatMoney(pnl.revenue.totalMinor)} revenue − ${formatMoney(pnl.costsMinor)} costs) ÷ ${formatMoney(pnl.revenue.totalMinor)}. As recorded (TVA included for TTC companies), cash basis, before IS.`,
      drill: { ...scope, kinds: ['income'] },
    });
  }
  const [prev, last] = input.monthly.slice(-3, -1);
  if (prev && last) {
    for (const [key, label, now, was] of [
      ['costs', 'Costs', last.costsMinor, prev.costsMinor],
      ['revenue', 'Revenue', last.revenueMinor, prev.revenueMinor],
    ] as const) {
      if (was <= 0) continue;
      const change = (now - was) / was;
      if (Math.abs(change) < 0.15 || Math.max(now, was) < 100_000) continue;
      const up = change > 0;
      out.push({
        id: `co-mom-${key}`,
        icon: up ? 'trending_up' : 'trending_down',
        tone: (key === 'costs') === up ? 'warning' : 'positive',
        title: `${label} ${up ? 'up' : 'down'} ${pct(Math.abs(change))} in ${formatMonthLabel(last.month)}`,
        calculation: `${formatMoney(now)} in ${formatMonthLabel(last.month)} vs ${formatMoney(was)} in ${formatMonthLabel(prev.month)}: (${formatMoney(now)} − ${formatMoney(was)}) ÷ ${formatMoney(was)}. Shown when the change is at least 15% and 1,000 DH.`,
        drill: { from: last.month, to: endOfMonth(last.month), companyId, kinds: [key === 'costs' ? 'expense' : 'income'] },
      });
    }
  }
  if (pnl.excluded.length > 0) {
    const total = pnl.excluded.reduce((s, g) => s + g.amountMinor, 0);
    out.push({
      id: 'co-excluded',
      icon: 'rule',
      tone: 'info',
      title: `${formatMoney(total)} of movements are not revenue or costs`,
      calculation: pnl.excluded.map((g) => `${g.label}: ${formatMoney(g.amountMinor)} — ${g.reason}`).join('. ') + '.',
    });
  }
  if (input.dashboard) {
    for (const c of input.dashboard.checks.filter((x) => x.tone !== 'info')) {
      out.push({ id: `co-check-${c.id}`, icon: c.tone === 'danger' ? 'error' : 'warning', tone: c.tone, title: c.title, calculation: c.detail, drill: c.drill, href: c.href });
    }
  }
  return out;
}

export type CompanyAnalytics = { pnl: CompanyPnl; monthly: MonthFigures[] };

/** P&L for `range` plus the last 12 calendar months (for month-over-month). */
export async function companyAnalytics(db: Db, companyId: string, range: DateRange): Promise<CompanyAnalytics> {
  const today = todayISO();
  const first = addMonths(startOfMonth(today), -11);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
  const [pnl, year] = await Promise.all([loadCompanyPnl(db, companyId, range), loadCompanyPnl(db, companyId, { from: first, to: today })]);
  return { pnl, monthly: monthlyPnl(year, months) };
}
