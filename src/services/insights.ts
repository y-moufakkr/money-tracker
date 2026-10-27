/**
 * Rule-based insights. Each one is computed from recorded data with a fixed
 * rule and carries a plain-language explanation of the calculation. No
 * insight is produced when the data needed for it is missing.
 */
import type { Db } from '@/db/types';
import { addDays, addMonths, daysBetweenInclusive, daysInMonth, formatDateLabel, startOfMonth, todayISO } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { formatNormalisedQuantity } from '@/domain/units';
import { applyFilter, breakdown, loadExpenseFacts, loadProductLines, productStats, type ExpenseFacts } from './analytics';
import { budgetStatuses, type BudgetStatus } from './budgets';
import { listGoals, type GoalProgress } from './goals';
import { NO_CATEGORY, type TransactionFilter } from './queries';

export type Insight = {
  id: string;
  icon: string;
  tone: 'info' | 'warning' | 'danger' | 'positive';
  title: string;
  /** How the figure was calculated. */
  calculation: string;
  /** Transactions behind the insight, when they can be listed. */
  drill?: TransactionFilter;
  /** Screen to open instead of a transaction list. */
  href?: string;
};

const pct = (r: number) => `${Math.round(r * 100)}%`;
const range = (from: string, to: string) => `${formatDateLabel(from)} – ${formatDateLabel(to)}`;

/** Month to date, and the same number of days at the start of last month. */
export function monthToDateWindows(today = todayISO()) {
  const from = startOfMonth(today);
  const days = daysBetweenInclusive(from, today);
  const prevFrom = addMonths(from, -1);
  const prevTo = addDays(prevFrom, Math.min(days, daysInMonth(prevFrom)) - 1);
  return { current: { from, to: today }, previous: { from: prevFrom, to: prevTo }, days };
}

/** Pure: insights about category spending, averages and the essential split. */
export function spendingInsights(cur: ExpenseFacts, prev: ExpenseFacts, days: number): Insight[] {
  const out: Insight[] = [];
  const { from, to } = cur.range;
  const drillBase: TransactionFilter = { from, to, kinds: ['expense'], ownership: 'personal' };
  const now = breakdown(applyFilter(cur.facts, null), 'category', cur.tags);
  const before = breakdown(applyFilter(prev.facts, null), 'category', prev.tags);
  if (now.totalMinor === 0) return out;

  for (const row of now.rows.slice(0, 2)) {
    out.push({
      id: `top-${row.key}`,
      icon: row.icon ?? 'category',
      tone: 'info',
      title:
        row.key === NO_CATEGORY
          ? `${formatMoney(row.totalMinor)} of this month's spending has no category`
          : `You spent ${formatMoney(row.totalMinor)} on ${row.label} this month`,
      calculation: `Sum of ${row.count} expense${row.count > 1 ? 's' : ''} in ${row.label}${row.drill?.includeSubcategories ? ' and its subcategories' : ''}, ${range(from, to)}. That is ${pct(row.totalMinor / now.totalMinor)} of this month's ${formatMoney(now.totalMinor)}.`,
      drill: row.drill ? { ...drillBase, ...row.drill } : undefined,
    });
  }

  // Changes vs the same days last month: only meaningful amounts (≥ 100 DH on either side) and ≥ 15 %.
  const changes = now.rows
    .map((row) => {
      const was = before.rows.find((b) => b.key === row.key)?.totalMinor ?? 0;
      return { row, was, change: was > 0 ? (row.totalMinor - was) / was : null };
    })
    .filter((c) => c.change !== null && Math.abs(c.change) >= 0.15 && Math.max(c.row.totalMinor, c.was) >= 10_000)
    .sort((a, b) => Math.abs(b.row.totalMinor - b.was) - Math.abs(a.row.totalMinor - a.was))
    .slice(0, 2);
  for (const c of changes) {
    const up = c.change! > 0;
    out.push({
      id: `change-${c.row.key}`,
      icon: up ? 'trending_up' : 'trending_down',
      tone: up ? 'warning' : 'positive',
      title: `${c.row.label} spending ${up ? 'up' : 'down'} ${pct(Math.abs(c.change!))} vs the same days last month`,
      calculation: `${formatMoney(c.row.totalMinor)} (${range(from, to)}) compared with ${formatMoney(c.was)} (${range(prev.range.from, prev.range.to)}): (${formatMoney(c.row.totalMinor)} − ${formatMoney(c.was)}) ÷ ${formatMoney(c.was)}.`,
      drill: c.row.drill ? { ...drillBase, ...c.row.drill } : undefined,
    });
  }

  const activeDays = new Set(cur.facts.map((f) => f.date)).size;
  out.push({
    id: 'daily-average',
    icon: 'calendar_month',
    tone: 'info',
    title: `Your average daily spending is ${formatMoney(Math.round(now.totalMinor / days))}`,
    calculation: `${formatMoney(now.totalMinor)} spent ÷ ${days} calendar days this month. Counting only the ${activeDays} day${activeDays > 1 ? 's' : ''} with spending, it is ${formatMoney(Math.round(now.totalMinor / Math.max(1, activeDays)))} per day.`,
    drill: drillBase,
  });

  const split = breakdown(applyFilter(cur.facts, null), 'essential', cur.tags);
  const essential = split.rows.find((r) => r.key === 'essential')?.totalMinor ?? 0;
  const discretionary = split.rows.find((r) => r.key === 'discretionary')?.totalMinor ?? 0;
  if (essential + discretionary > 0) {
    const unclassified = now.totalMinor - essential - discretionary;
    out.push({
      id: 'essential-split',
      icon: 'balance',
      tone: 'info',
      title: `${pct(essential / now.totalMinor)} of this month's spending was essential`,
      calculation: `Essential ${formatMoney(essential)}, discretionary ${formatMoney(discretionary)}${unclassified > 0 ? `, not classified ${formatMoney(unclassified)}` : ''}, out of ${formatMoney(now.totalMinor)}. Based on each category's essential setting (subcategories inherit it).`,
      drill: { ...drillBase, essential: 'discretionary' },
    });
  }
  return out;
}

/** Pure: product quantity and cheapest-price insights. Only compatible units are combined. */
export function productInsights(
  monthLines: Awaited<ReturnType<typeof loadProductLines>>,
  allLines: Awaited<ReturnType<typeof loadProductLines>>,
  month: { from: string; to: string },
): Insight[] {
  const out: Insight[] = [];
  const byProduct = (lines: typeof allLines) => {
    const m = new Map<string, { name: string; lines: typeof allLines }>();
    for (const l of lines) {
      const p = m.get(l.productId) ?? { name: l.productName, lines: [] };
      p.lines.push(l);
      m.set(l.productId, p);
    }
    return m;
  };

  const monthly = [...byProduct(monthLines).entries()]
    .map(([id, p]) => ({ id, name: p.name, stats: productStats(p.lines) }))
    .filter((p) => p.stats.groups[0]?.quantityMicro > 0 && p.stats.groups[0].group !== 'count')
    .sort((a, b) => b.stats.totalSpentMinor - a.stats.totalSpentMinor);
  for (const p of monthly.slice(0, 1)) {
    const g = p.stats.groups[0];
    out.push({
      id: `qty-${p.id}`,
      icon: 'shopping_basket',
      tone: 'info',
      title: `You bought ${formatNormalisedQuantity(g.quantityMicro)} ${g.unitLabel} of ${p.name} this month for ${formatMoney(g.measuredSpentMinor)}`,
      calculation: `Sum of ${g.lineCount} item line${g.lineCount > 1 ? 's' : ''} recorded in ${g.unitLabel === 'kg' ? 'kg or g' : g.unitLabel === 'L' ? 'L, cl or ml' : g.unitLabel}, ${range(month.from, month.to)}. Lines without a quantity or in other units are not included.`,
      href: `/products/${p.id}`,
    });
  }

  const priced = [...byProduct(allLines).entries()]
    .map(([id, p]) => ({ id, name: p.name, stats: productStats(p.lines) }))
    .filter((p) => (p.stats.groups[0]?.series.length ?? 0) >= 2)
    .sort((a, b) => b.stats.purchaseCount - a.stats.purchaseCount);
  for (const p of priced.slice(0, 2)) {
    const g = p.stats.groups[0];
    const cheap = g.cheapest!;
    const latest = g.latest!;
    out.push({
      id: `cheapest-${p.id}`,
      icon: 'sell',
      tone: 'positive',
      title: `Cheapest ${p.name}: ${formatMoney(cheap.priceMinor)}/${g.unitLabel}${cheap.merchantName ? ` at ${cheap.merchantName}` : ''}`,
      calculation: `Lowest of ${g.series.length} recorded prices, each normalised to a price per ${g.unitLabel} (total ÷ quantity), on ${formatDateLabel(cheap.date)}. Latest: ${formatMoney(latest.priceMinor)}/${g.unitLabel} on ${formatDateLabel(latest.date)}.`,
      href: `/products/${p.id}`,
    });
  }
  return out;
}

/** Pure: warnings for budgets at or past a threshold, or projected to go over. */
export function budgetInsights(statuses: BudgetStatus[]): Insight[] {
  const out: Insight[] = [];
  for (const s of statuses) {
    if (s.daysElapsed === 0) continue;
    const t = s.total;
    const reached = t.thresholdReached;
    if (reached === null && !s.projectedOver) continue;
    const over = t.usedRatio >= 1;
    out.push({
      id: `budget-${s.budget.id}`,
      icon: over ? 'error' : 'warning',
      tone: over ? 'danger' : 'warning',
      title: over
        ? `${s.budget.name}: ${formatMoney(-t.remainingMinor)} over budget`
        : reached !== null
          ? `${s.budget.name}: ${pct(t.usedRatio)} used${s.daysLeft > 0 ? ` with ${s.daysLeft} day${s.daysLeft > 1 ? 's' : ''} left` : ''}`
          : `${s.budget.name} is on course to go over`,
      calculation: `Spent ${formatMoney(t.spentMinor)} of ${formatMoney(t.budgetMinor)} (${range(s.range.from, s.range.to)}). Projection: ${formatMoney(t.spentMinor)} ÷ ${s.daysElapsed} days elapsed × ${s.daysTotal} days = ${formatMoney(t.projectedMinor)}.`,
      href: '/budgets',
    });
    for (const l of s.lines.filter((x) => x.usedRatio >= 1)) {
      out.push({
        id: `budget-${s.budget.id}-${l.categoryId}`,
        icon: 'error',
        tone: 'danger',
        title: `${l.name} is over its ${s.budget.name.toLowerCase()} limit`,
        calculation: `Spent ${formatMoney(l.spentMinor)} of ${formatMoney(l.budgetMinor)} on ${l.name} (including subcategories without their own limit), ${range(s.range.from, s.range.to)}.`,
        drill: { from: s.range.from, to: s.range.to, kinds: ['expense'], ownership: 'personal', categoryId: l.categoryId, includeSubcategories: true },
      });
    }
  }
  return out;
}

/** Pure: goals whose planned contribution will not reach the target in time. */
export function goalInsights(goals: GoalProgress[]): Insight[] {
  return goals
    .filter((g) => g.remainingMinor > 0 && g.plan.neededPerMonthMinor !== null && g.plan.onTrack === false)
    .map((g) => ({
      id: `goal-${g.id}`,
      icon: 'flag',
      tone: 'warning' as const,
      title: `${g.name} needs ${formatMoney(g.plan.neededPerMonthMinor!)}/month to finish on time`,
      calculation: `${formatMoney(g.remainingMinor)} still to reserve ÷ ${g.plan.monthsLeft} month${g.plan.monthsLeft! > 1 ? 's' : ''} until ${formatDateLabel(g.targetDate!)}. Your plan is ${formatMoney(g.monthlyPlanMinor!)}/month.`,
      href: `/goals/${g.id}`,
    }));
}

export async function insights(db: Db, today = todayISO()): Promise<Insight[]> {
  const w = monthToDateWindows(today);
  const [cur, prev, monthLines, allLines, statuses, goals] = await Promise.all([
    loadExpenseFacts(db, w.current),
    loadExpenseFacts(db, w.previous),
    loadProductLines(db, { range: w.current }),
    loadProductLines(db),
    budgetStatuses(db, today),
    listGoals(db),
  ]);
  return [
    ...budgetInsights(statuses),
    ...spendingInsights(cur, prev, w.days),
    ...productInsights(monthLines, allLines, w.current),
    ...goalInsights(goals),
  ];
}
