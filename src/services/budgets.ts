/**
 * Budgets are plans, not money: saving or changing one never touches a
 * transaction. "Actual" is always recomputed from recorded expenses.
 *
 * A category line covers that category and those of its subcategories that
 * have no line of their own, so lines never overlap and no dirham is
 * counted against two lines.
 */
import { LedgerError, type Db } from '@/db/types';
import { bucketRange, daysBetweenInclusive, isValidISODate, todayISO, type DateRange } from '@/domain/dates';
import { BASE_CURRENCY } from '@/domain/money';
import type { Budget, BudgetPeriod } from '@/domain/types';
import { newId, nowISO } from '@/lib/id';
import { loadExpenseFacts, type ExpenseFact } from './analytics';

type BudgetRow = {
  id: string;
  name: string;
  period: BudgetPeriod;
  start_date: string | null;
  end_date: string | null;
  amount_minor: number | null;
  currency: string;
  thresholds: string;
  is_archived: number;
};

export const DEFAULT_THRESHOLDS = [75, 90, 100];

export function parseThresholds(s: string): number[] {
  return s
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export async function listBudgets(db: Db, opts: { includeArchived?: boolean } = {}): Promise<Budget[]> {
  const [rows, lines] = await Promise.all([
    db.all<BudgetRow>(`SELECT * FROM budgets ${opts.includeArchived ? '' : 'WHERE is_archived = 0'} ORDER BY created_at`),
    db.all<{ id: string; budget_id: string; category_id: string; amount_minor: number }>(
      'SELECT bl.id, bl.budget_id, bl.category_id, bl.amount_minor FROM budget_lines bl ORDER BY bl.amount_minor DESC',
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    period: r.period,
    startDate: r.start_date,
    endDate: r.end_date,
    amountMinor: r.amount_minor,
    currency: r.currency,
    thresholds: parseThresholds(r.thresholds),
    isArchived: r.is_archived === 1,
    lines: lines
      .filter((l) => l.budget_id === r.id)
      .map((l) => ({ id: l.id, categoryId: l.category_id, amountMinor: l.amount_minor })),
  }));
}

export async function getBudget(db: Db, id: string): Promise<Budget | null> {
  return (await listBudgets(db, { includeArchived: true })).find((b) => b.id === id) ?? null;
}

export type BudgetInput = {
  name: string;
  period: BudgetPeriod;
  startDate?: string | null;
  endDate?: string | null;
  amountMinor: number | null;
  thresholds?: number[];
  lines: { categoryId: string; amountMinor: number }[];
};

function validateBudget(input: BudgetInput) {
  if (!input.name.trim()) throw new LedgerError('Give the budget a name.');
  if (input.period === 'custom') {
    if (!input.startDate || !input.endDate || !isValidISODate(input.startDate) || !isValidISODate(input.endDate)) {
      throw new LedgerError('A custom budget needs a start and an end date.');
    }
    if (input.startDate > input.endDate) throw new LedgerError('The end date must be after the start date.');
  }
  const amount = input.amountMinor;
  if (amount !== null && (!Number.isSafeInteger(amount) || amount <= 0)) throw new LedgerError('The overall limit must be greater than zero.');
  if (amount === null && input.lines.length === 0) throw new LedgerError('Set an overall limit or at least one category limit.');
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!Number.isSafeInteger(l.amountMinor) || l.amountMinor <= 0) throw new LedgerError('Each category limit must be greater than zero.');
    if (seen.has(l.categoryId)) throw new LedgerError('A category can only appear once in a budget.');
    seen.add(l.categoryId);
  }
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  if (t.length === 0 || t.some((n, i) => !Number.isInteger(n) || n <= 0 || n > 500 || (i > 0 && n <= t[i - 1]))) {
    throw new LedgerError('Warning thresholds must be whole percentages in increasing order, e.g. 75, 90, 100.');
  }
}

/** Creates or updates a budget and replaces its lines, atomically. Transactions are never touched. */
export async function saveBudget(db: Db, input: BudgetInput, id: string | null = null): Promise<string> {
  validateBudget(input);
  return db.transaction(async (tx) => {
    for (const l of input.lines) {
      const c = await tx.first<{ kind: string }>('SELECT kind FROM categories WHERE id = ?', [l.categoryId]);
      if (!c) throw new LedgerError('Category not found.');
      if (c.kind !== 'expense') throw new LedgerError('Budgets only cover expense categories.');
    }
    const ts = nowISO();
    const values = [
      input.name.trim(),
      input.period,
      input.period === 'custom' ? input.startDate! : null,
      input.period === 'custom' ? input.endDate! : null,
      input.amountMinor,
      (input.thresholds ?? DEFAULT_THRESHOLDS).join(','),
    ];
    let budgetId = id;
    if (budgetId) {
      const r = await tx.run(
        `UPDATE budgets SET name = ?, period = ?, start_date = ?, end_date = ?, amount_minor = ?, thresholds = ?, updated_at = ?
         WHERE id = ?`,
        [...values, ts, budgetId],
      );
      if (r.changes === 0) throw new LedgerError('Budget not found.');
      await tx.run('DELETE FROM budget_lines WHERE budget_id = ?', [budgetId]);
    } else {
      budgetId = newId();
      await tx.run(
        `INSERT INTO budgets (name, period, start_date, end_date, amount_minor, thresholds, id, currency, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [...values, budgetId, BASE_CURRENCY, ts, ts],
      );
    }
    for (const l of input.lines) {
      await tx.run(
        'INSERT INTO budget_lines (id, budget_id, category_id, amount_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [newId(), budgetId, l.categoryId, l.amountMinor, ts, ts],
      );
    }
    return budgetId;
  });
}

export async function deleteBudget(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM budget_lines WHERE budget_id = ?', [id]);
    await tx.run('DELETE FROM budgets WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Budget vs actual

/** The period a budget applies to on `today`: this week, this month, or its custom dates. */
export function budgetRange(b: Pick<Budget, 'period' | 'startDate' | 'endDate'>, today = todayISO()): DateRange {
  if (b.period === 'custom') return { from: b.startDate!, to: b.endDate! };
  return bucketRange(b.period === 'weekly' ? 'week' : 'month', today);
}

export type BudgetMeter = {
  budgetMinor: number;
  spentMinor: number;
  remainingMinor: number;
  /** spent ÷ budget (0.82 = 82 %). */
  usedRatio: number;
  /** Projected spending at the end of the period (equals spent once it is over). */
  projectedMinor: number;
  /** Highest warning threshold reached, e.g. 90; null below the first one. */
  thresholdReached: number | null;
};

export type BudgetLineStatus = BudgetMeter & {
  categoryId: string;
  name: string;
  color: string | null;
  icon: string | null;
};

export type BudgetStatus = {
  budget: Budget;
  range: DateRange;
  daysTotal: number;
  daysElapsed: number;
  /** Days left including today; 0 once the period is over. */
  daysLeft: number;
  /** Overall limit (the explicit limit, or the sum of the lines). */
  total: BudgetMeter;
  lines: BudgetLineStatus[];
  /** Spending not covered by any line, against what the overall limit leaves for it. Null without an explicit overall limit. */
  other: (BudgetMeter & { coveredByLinesMinor: number }) | null;
  /** The projection exceeds the limit. */
  projectedOver: boolean;
};

function meter(budget: number, spent: number, elapsed: number, total: number, thresholds: number[]): BudgetMeter {
  const usedRatio = budget > 0 ? spent / budget : spent > 0 ? Infinity : 0;
  const projected = elapsed > 0 && elapsed < total ? Math.round((spent * total) / elapsed) : spent;
  const pct = usedRatio * 100;
  const reached = thresholds.filter((t) => pct >= t);
  return {
    budgetMinor: budget,
    spentMinor: spent,
    remainingMinor: budget - spent,
    usedRatio,
    projectedMinor: projected,
    thresholdReached: reached.length ? reached[reached.length - 1] : null,
  };
}

/** Pure: budget vs actual for the given facts (personal expenses within `range`). */
export function computeBudgetStatus(
  budget: Budget,
  facts: ExpenseFact[],
  range: DateRange,
  categories: { id: string; name: string; parentId: string | null; color: string | null; icon: string | null }[],
  today = todayISO(),
): BudgetStatus {
  const daysTotal = daysBetweenInclusive(range.from, range.to);
  const daysElapsed = today < range.from ? 0 : today > range.to ? daysTotal : daysBetweenInclusive(range.from, today);
  const daysLeft = daysTotal - daysElapsed + (daysElapsed > 0 && today <= range.to ? 1 : 0);
  const inRange = facts.filter((f) => f.date >= range.from && f.date <= range.to);
  const spent = inRange.reduce((s, f) => s + f.amountMinor, 0);

  const lineIds = new Set(budget.lines.map((l) => l.categoryId));
  const catById = new Map(categories.map((c) => [c.id, c]));
  /** The line a category's spending counts against: its own, else its parent's. */
  const lineFor = (categoryId: string | null): string | null => {
    if (!categoryId) return null;
    if (lineIds.has(categoryId)) return categoryId;
    const parent = catById.get(categoryId)?.parentId;
    return parent && lineIds.has(parent) ? parent : null;
  };
  const spentByLine = new Map<string, number>();
  let covered = 0;
  for (const f of inRange) {
    const line = lineFor(f.categoryId);
    if (!line) continue;
    spentByLine.set(line, (spentByLine.get(line) ?? 0) + f.amountMinor);
    covered += f.amountMinor;
  }

  const t = budget.thresholds;
  const linesTotal = budget.lines.reduce((s, l) => s + l.amountMinor, 0);
  const totalBudget = budget.amountMinor ?? linesTotal;
  const total = meter(totalBudget, spent, daysElapsed, daysTotal, t);
  const lines = budget.lines.map((l) => {
    const c = catById.get(l.categoryId);
    return {
      ...meter(l.amountMinor, spentByLine.get(l.categoryId) ?? 0, daysElapsed, daysTotal, t),
      categoryId: l.categoryId,
      name: c?.name ?? 'Category',
      color: c?.color ?? null,
      icon: c?.icon ?? null,
    };
  });
  const other =
    budget.amountMinor !== null && budget.lines.length > 0
      ? { ...meter(Math.max(0, budget.amountMinor - linesTotal), spent - covered, daysElapsed, daysTotal, t), coveredByLinesMinor: covered }
      : null;
  return {
    budget,
    range,
    daysTotal,
    daysElapsed,
    daysLeft,
    total,
    lines,
    other,
    projectedOver: daysElapsed > 0 && total.projectedMinor > totalBudget,
  };
}

export async function budgetStatuses(db: Db, today = todayISO()): Promise<BudgetStatus[]> {
  const [budgets, categories] = await Promise.all([
    listBudgets(db),
    db.all<{ id: string; name: string; parent_id: string | null; color: string | null; icon: string | null }>(
      "SELECT id, name, parent_id, color, icon FROM categories WHERE kind = 'expense'",
    ),
  ]);
  const cats = categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id, color: c.color, icon: c.icon }));
  const out: BudgetStatus[] = [];
  for (const b of budgets) {
    const range = budgetRange(b, today);
    const facts = await loadExpenseFacts(db, range);
    out.push(computeBudgetStatus(b, facts.facts, range, cats, today));
  }
  return out;
}
