/**
 * Savings goals. A goal never holds money: it reserves parts of real
 * personal accounts through allocations. Totals always come from the
 * accounts (balances.ts); goal progress only counts what the accounts back.
 */
import { LedgerError, type Db } from '@/db/types';
import { addMonths, daysBetweenInclusive, isValidISODate, todayISO } from '@/domain/dates';
import { BASE_CURRENCY, convertToBase, formatMoney } from '@/domain/money';
import type { GoalAllocation, SavingsGoal } from '@/domain/types';
import { newId, nowISO } from '@/lib/id';
import { requireAccount } from './accounts';
import { accountBalance, accountBalances, listAllocations, reserveAllocations } from './balances';
import { latestRates } from './fx';

/** Thrown when an allocation would reserve more than the account holds. Retry with `allowOverAllocation` after the user confirms. */
export class OverAllocationError extends LedgerError {
  constructor(
    readonly accountName: string,
    readonly unallocatedMinor: number,
    readonly requestedMinor: number,
    readonly currency: string,
  ) {
    super(
      `${accountName} has only ${formatMoney(Math.max(0, unallocatedMinor), currency)} not yet reserved, ` +
        `but ${formatMoney(requestedMinor, currency)} was requested. Reserving more than an account holds does not create money.`,
    );
    this.name = 'OverAllocationError';
  }
}

type GoalRow = {
  id: string;
  name: string;
  target_minor: number;
  currency: string;
  target_date: string | null;
  monthly_plan_minor: number | null;
  icon: string | null;
  color: string | null;
  notes: string | null;
};

const mapGoal = (r: GoalRow): SavingsGoal => ({
  id: r.id,
  name: r.name,
  targetMinor: r.target_minor,
  currency: r.currency,
  targetDate: r.target_date,
  monthlyPlanMinor: r.monthly_plan_minor,
  icon: r.icon,
  color: r.color,
  notes: r.notes,
});

export type GoalInput = {
  name: string;
  targetMinor: number;
  targetDate?: string | null;
  monthlyPlanMinor?: number | null;
  icon?: string | null;
  color?: string | null;
  notes?: string | null;
};

function validateGoal(input: GoalInput) {
  if (!input.name.trim()) throw new LedgerError('Give the goal a name.');
  if (!Number.isSafeInteger(input.targetMinor) || input.targetMinor <= 0) throw new LedgerError('Target must be greater than zero.');
  if (input.targetDate && !isValidISODate(input.targetDate)) throw new LedgerError('Target date is invalid.');
  const plan = input.monthlyPlanMinor;
  if (plan !== null && plan !== undefined && (!Number.isSafeInteger(plan) || plan <= 0)) {
    throw new LedgerError('Monthly contribution must be greater than zero, or left empty.');
  }
}

export async function createGoal(db: Db, input: GoalInput): Promise<string> {
  validateGoal(input);
  const id = newId();
  const ts = nowISO();
  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO savings_goals (id, name, target_minor, currency, target_date, monthly_plan_minor, icon, color, notes,
         sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM savings_goals), ?, ?)`,
      [
        id,
        input.name.trim(),
        input.targetMinor,
        BASE_CURRENCY,
        input.targetDate ?? null,
        input.monthlyPlanMinor ?? null,
        input.icon ?? 'flag',
        input.color ?? null,
        input.notes?.trim() || null,
        ts,
        ts,
      ],
    );
  });
  return id;
}

export async function updateGoal(db: Db, id: string, input: GoalInput): Promise<void> {
  validateGoal(input);
  await db.transaction(async (tx) => {
    const r = await tx.run(
      `UPDATE savings_goals SET name = ?, target_minor = ?, target_date = ?, monthly_plan_minor = ?, icon = ?, color = ?,
         notes = ?, updated_at = ? WHERE id = ?`,
      [
        input.name.trim(),
        input.targetMinor,
        input.targetDate ?? null,
        input.monthlyPlanMinor ?? null,
        input.icon ?? 'flag',
        input.color ?? null,
        input.notes?.trim() || null,
        nowISO(),
        id,
      ],
    );
    if (r.changes === 0) throw new LedgerError('Goal not found.');
  });
}

/** Deleting a goal releases its reservations. No money moves. */
export async function deleteGoal(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM goal_allocations WHERE goal_id = ?', [id]);
    await tx.run('DELETE FROM savings_goals WHERE id = ?', [id]);
  });
}

export type AllocationInput = {
  goalId: string;
  accountId: string;
  /** New reserved amount in the account's currency. 0 removes the allocation. */
  amountMinor: number;
  /** Set after the user explicitly confirmed reserving more than the account holds. */
  allowOverAllocation?: boolean;
};

/**
 * Sets how much of an account is reserved for a goal. Refuses (with
 * OverAllocationError) to reserve more than the account's unallocated
 * balance unless explicitly allowed. Lowering an allocation is always allowed.
 */
export async function setAllocation(db: Db, input: AllocationInput): Promise<void> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) throw new LedgerError('Amount is invalid.');
  await db.transaction(async (tx) => {
    const goal = await tx.first<{ id: string }>('SELECT id FROM savings_goals WHERE id = ?', [input.goalId]);
    if (!goal) throw new LedgerError('Goal not found.');
    const account = await requireAccount(tx, input.accountId);
    if (account.ownership !== 'personal') throw new LedgerError('Goals can only reserve personal money, not company funds.');
    if (account.kind === 'credit_card') throw new LedgerError('A credit card holds debt, not savings. Choose another location.');

    const existing = await tx.first<{ id: string; amount_minor: number }>(
      'SELECT id, amount_minor FROM goal_allocations WHERE goal_id = ? AND account_id = ?',
      [input.goalId, input.accountId],
    );
    if (input.amountMinor === 0) {
      if (existing) await tx.run('DELETE FROM goal_allocations WHERE id = ?', [existing.id]);
      return;
    }
    if (account.isArchived) throw new LedgerError(`"${account.name}" is archived.`);

    const increasing = input.amountMinor > (existing?.amount_minor ?? 0);
    if (increasing && !input.allowOverAllocation) {
      const balance = await accountBalance(tx, account.id);
      const others = await tx.first<{ total: number | null }>(
        'SELECT SUM(amount_minor) AS total FROM goal_allocations WHERE account_id = ? AND goal_id <> ?',
        [account.id, input.goalId],
      );
      const unallocated = balance - (others?.total ?? 0);
      if (input.amountMinor > unallocated) {
        throw new OverAllocationError(account.name, unallocated, input.amountMinor, account.currency);
      }
    }

    const ts = nowISO();
    if (existing) {
      await tx.run('UPDATE goal_allocations SET amount_minor = ?, updated_at = ? WHERE id = ?', [input.amountMinor, ts, existing.id]);
    } else {
      await tx.run(
        `INSERT INTO goal_allocations (id, goal_id, account_id, amount_minor, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId(), input.goalId, input.accountId, input.amountMinor, ts, ts],
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Reads

export type GoalAllocationView = GoalAllocation & {
  accountName: string;
  currency: string;
  /** Part of this allocation the account's balance actually covers. */
  backedMinor: number;
  /** Backed amount in MAD, or null without an exchange rate. */
  backedBaseMinor: number | null;
};

export type GoalProgress = SavingsGoal & {
  allocations: GoalAllocationView[];
  /** Σ allocated (MAD, converted where possible). */
  allocatedMinor: number;
  /** Σ backed by real balances (MAD). Progress uses this figure. */
  savedMinor: number;
  remainingMinor: number;
  /** 0–1, capped at 1. */
  progress: number;
  /** Part of the allocations the accounts cannot cover right now. */
  unbackedMinor: number;
  /** Allocations in a currency without an exchange rate (not counted). */
  unconverted: string[];
  plan: GoalPlan;
};

export type GoalPlan = {
  /** Whole months from today until the target date (at least 1), null without a date. */
  monthsLeft: number | null;
  /** Monthly amount needed to reach the target by the date. */
  neededPerMonthMinor: number | null;
  /** Months to reach the target at the planned monthly contribution. */
  monthsAtPlan: number | null;
  /** Projected completion date at the planned contribution. */
  projectedDate: string | null;
  /** The planned contribution is enough to meet the date. */
  onTrack: boolean | null;
};

/** Pure planning maths, shown with the goal so the user can check it. */
export function goalPlan(goal: Pick<SavingsGoal, 'targetDate' | 'monthlyPlanMinor'>, remainingMinor: number, today = todayISO()): GoalPlan {
  let monthsLeft: number | null = null;
  if (goal.targetDate) {
    const days = goal.targetDate < today ? 0 : daysBetweenInclusive(today, goal.targetDate);
    monthsLeft = Math.max(1, Math.round(days / 30.44));
  }
  const neededPerMonthMinor = monthsLeft === null ? null : Math.ceil(Math.max(0, remainingMinor) / monthsLeft);
  const plan = goal.monthlyPlanMinor;
  const monthsAtPlan = plan ? Math.ceil(Math.max(0, remainingMinor) / plan) : null;
  return {
    monthsLeft,
    neededPerMonthMinor,
    monthsAtPlan,
    projectedDate: monthsAtPlan === null ? null : addMonths(today, monthsAtPlan),
    onTrack: plan && neededPerMonthMinor !== null ? plan >= neededPerMonthMinor : null,
  };
}

export async function listGoals(db: Db): Promise<GoalProgress[]> {
  const today = todayISO();
  const [rows, balances, allocations, rates] = await Promise.all([
    db.all<GoalRow>('SELECT * FROM savings_goals ORDER BY sort_order, created_at'),
    accountBalances(db, { includeArchived: true }),
    listAllocations(db),
    latestRates(db, today),
  ]);
  const reservations = reserveAllocations(balances, allocations);
  const accounts = new Map(balances.map((a) => [a.id, a]));
  const allocRows = await db.all<{ id: string; goal_id: string; account_id: string; amount_minor: number }>(
    'SELECT id, goal_id, account_id, amount_minor FROM goal_allocations ORDER BY created_at',
  );

  return rows.map((r) => {
    const goal = mapGoal(r);
    const unconverted = new Set<string>();
    let allocated = 0;
    let saved = 0;
    const views: GoalAllocationView[] = allocRows
      .filter((a) => a.goal_id === goal.id)
      .map((a) => {
        const account = accounts.get(a.account_id);
        const currency = account?.currency ?? BASE_CURRENCY;
        const backed = reservations.get(a.account_id)?.byGoal.get(goal.id) ?? 0;
        const backedBase = convertToBase(backed, currency, rates);
        const allocatedBase = convertToBase(a.amount_minor, currency, rates);
        if (backedBase === null || allocatedBase === null) unconverted.add(currency);
        else {
          saved += backedBase;
          allocated += allocatedBase;
        }
        return {
          id: a.id,
          goalId: goal.id,
          accountId: a.account_id,
          amountMinor: a.amount_minor,
          accountName: account?.name ?? 'Unknown location',
          currency,
          backedMinor: backed,
          backedBaseMinor: backedBase,
        };
      });
    const remaining = Math.max(0, goal.targetMinor - saved);
    return {
      ...goal,
      allocations: views,
      allocatedMinor: allocated,
      savedMinor: saved,
      remainingMinor: remaining,
      progress: Math.min(1, saved / goal.targetMinor),
      unbackedMinor: allocated - saved,
      unconverted: [...unconverted],
      plan: goalPlan(goal, remaining, today),
    };
  });
}

export async function getGoal(db: Db, id: string): Promise<GoalProgress | null> {
  return (await listGoals(db)).find((g) => g.id === id) ?? null;
}
