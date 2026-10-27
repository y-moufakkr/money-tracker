import type { Db } from '@/db/types';
import { addDays, addMonths } from '@/domain/dates';
import { createTestDb } from '@/test/node-db';
import { businessAccount, count, DH, personalAccount, today } from '@/test/fixtures';
import { createAccount, setAccountArchived } from './accounts';
import { accountBalance, moneySummary, reserveAllocations } from './balances';
import { createGoal, deleteGoal, getGoal, goalPlan, listGoals, OverAllocationError, setAllocation } from './goals';
import { saveExpense, saveTransfer } from './ledger';

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function goal(name: string, target: number) {
  return createGoal(db, { name, targetMinor: DH(target) });
}

describe('goal allocations reserve money without counting it twice', () => {
  it('splits a savings account between goals; the account and totals are unchanged', async () => {
    const savings = await personalAccount(db, 'Savings account', 'savings', 15000);
    await personalAccount(db, 'Bank', 'bank', 20000);
    const emergency = await goal('Emergency fund', 20000);
    const maternity = await goal('Maternity', 5000);

    await setAllocation(db, { goalId: emergency, accountId: savings, amountMinor: DH(10000) });
    await setAllocation(db, { goalId: maternity, accountId: savings, amountMinor: DH(5000) });

    expect(await accountBalance(db, savings)).toBe(DH(15000));
    expect(await count(db, 'SELECT COUNT(*) AS n FROM postings')).toBe(0);
    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(35000));
    expect(s.personal.savings).toBe(DH(15000));
    expect(s.personal.reserved).toBe(DH(15000));
    expect(s.personal.available).toBe(DH(20000));
    expect(s.personal.overAllocated).toHaveLength(0);

    const goals = await listGoals(db);
    expect(goals.map((g) => g.savedMinor)).toEqual([DH(10000), DH(5000)]);
    expect(goals[0].progress).toBe(0.5);
    expect(goals[1].progress).toBe(1);
    expect(goals[0].remainingMinor).toBe(DH(10000));
  });

  it('re-allocating replaces the amount instead of adding to it', async () => {
    const savings = await personalAccount(db, 'Savings', 'savings', 1000);
    const g = await goal('Holiday', 5000);
    await setAllocation(db, { goalId: g, accountId: savings, amountMinor: DH(600) });
    await setAllocation(db, { goalId: g, accountId: savings, amountMinor: DH(400) });
    expect((await moneySummary(db)).personal.reserved).toBe(DH(400));
    await setAllocation(db, { goalId: g, accountId: savings, amountMinor: 0 });
    expect(await count(db, 'SELECT COUNT(*) AS n FROM goal_allocations')).toBe(0);
  });

  it('deleting a goal releases its reservation and moves no money', async () => {
    const savings = await personalAccount(db, 'Savings', 'savings', 1000);
    const g = await goal('Holiday', 5000);
    await setAllocation(db, { goalId: g, accountId: savings, amountMinor: DH(700) });
    await deleteGoal(db, g);
    const s = await moneySummary(db);
    expect(s.personal.reserved).toBe(0);
    expect(s.personal.available).toBe(DH(1000));
    expect(await accountBalance(db, savings)).toBe(DH(1000));
  });

  it('only reserves personal, non-credit money', async () => {
    const company = await businessAccount(db, 'Company bank', 50000);
    const cc = await createAccount(db, { name: 'CC', kind: 'credit_card', ownership: 'personal', openingBalanceMinor: 0, openingDate: today });
    const g = await goal('Car', 5000);
    await expect(setAllocation(db, { goalId: g, accountId: company, amountMinor: DH(100) })).rejects.toThrow(/company/);
    await expect(setAllocation(db, { goalId: g, accountId: cc, amountMinor: DH(100) })).rejects.toThrow(/credit card/);
  });
});

describe('over-allocation protection', () => {
  it('refuses to reserve more than the unallocated balance without explicit confirmation', async () => {
    const savings = await personalAccount(db, 'Savings', 'savings', 15000);
    const a = await goal('Emergency', 20000);
    const b = await goal('Maternity', 10000);
    await setAllocation(db, { goalId: a, accountId: savings, amountMinor: DH(10000) });

    const attempt = setAllocation(db, { goalId: b, accountId: savings, amountMinor: DH(6000) });
    await expect(attempt).rejects.toBeInstanceOf(OverAllocationError);
    await expect(setAllocation(db, { goalId: b, accountId: savings, amountMinor: DH(6000) })).rejects.toThrow(/5,000 DH/);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM goal_allocations')).toBe(1);

    // Explicitly confirmed: stored, but totals still only reserve what exists.
    await setAllocation(db, { goalId: b, accountId: savings, amountMinor: DH(6000), allowOverAllocation: true });
    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(15000));
    expect(s.personal.reserved).toBe(DH(15000));
    expect(s.personal.available).toBe(0);
    expect(s.personal.overAllocated).toHaveLength(1);
    expect(s.personal.overAllocated[0].shortMinor).toBe(DH(1000));

    // The 15,000 DH held is split pro rata: 10/16 and 6/16. Progress never exceeds real money.
    const goals = await listGoals(db);
    expect(goals[0].savedMinor + goals[1].savedMinor).toBe(DH(15000));
    expect(goals[0].savedMinor).toBe(937_500);
    expect(goals[1].savedMinor).toBe(562_500);
    expect(goals[1].unbackedMinor).toBe(DH(6000) - 562_500);
  });

  it('lowering an allocation on an over-allocated account is always allowed', async () => {
    const savings = await personalAccount(db, 'Savings', 'savings', 1000);
    const g = await goal('Holiday', 5000);
    await setAllocation(db, { goalId: g, accountId: savings, amountMinor: DH(2000), allowOverAllocation: true });
    await setAllocation(db, { goalId: g, accountId: savings, amountMinor: DH(1500) });
    expect((await getGoal(db, g))?.allocatedMinor).toBe(DH(1500));
  });

  it('spending from a reserved account shrinks what is reserved, never the other totals', async () => {
    const savings = await personalAccount(db, 'Savings', 'savings', 15000);
    const wallet = await personalAccount(db, 'Wallet', 'cash', 0);
    const a = await goal('Emergency', 20000);
    const b = await goal('Maternity', 10000);
    await setAllocation(db, { goalId: a, accountId: savings, amountMinor: DH(10000) });
    await setAllocation(db, { goalId: b, accountId: savings, amountMinor: DH(5000) });

    await saveTransfer(db, { date: today, fromAccountId: savings, toAccountId: wallet, amountMinor: DH(3000) });
    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(15000));
    expect(s.personal.reserved).toBe(DH(12000));
    expect(s.personal.available).toBe(DH(3000));
    const goals = await listGoals(db);
    expect(goals.map((g) => g.savedMinor)).toEqual([DH(8000), DH(4000)]);
  });

  it('an overdrawn account backs nothing', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 100);
    const g = await goal('Holiday', 5000);
    await setAllocation(db, { goalId: g, accountId: bank, amountMinor: DH(100) });
    await saveExpense(db, { date: today, amountMinor: DH(150), accountId: bank });
    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(-50));
    expect(s.personal.reserved).toBe(0);
    expect((await getGoal(db, g))?.savedMinor).toBe(0);
  });

  it('splits a shortfall so backed amounts always add up exactly', () => {
    const r = reserveAllocations(
      [{ id: 'acc', balanceMinor: 2 }],
      [
        { goalId: 'a', accountId: 'acc', amountMinor: 1 },
        { goalId: 'b', accountId: 'acc', amountMinor: 1 },
        { goalId: 'c', accountId: 'acc', amountMinor: 1 },
      ],
    ).get('acc')!;
    expect([...r.byGoal.values()].reduce((s, v) => s + v, 0)).toBe(2);
    expect(r.backedMinor).toBe(2);
    expect(r.overAllocatedMinor).toBe(1);
    expect(r.unallocatedMinor).toBe(0);
  });
});

describe('reservations in other views', () => {
  it('a historical view has no reservations and includes since-archived locations', async () => {
    const savings = await personalAccount(db, 'Savings', 'savings', 1000);
    const old = await personalAccount(db, 'Old wallet', 'cash', 200);
    const g = await goal('Holiday', 5000);
    await setAllocation(db, { goalId: g, accountId: savings, amountMinor: DH(500) });
    await saveTransfer(db, { date: addDays(today, -5), fromAccountId: old, toAccountId: savings, amountMinor: DH(200) });
    await setAccountArchived(db, old, true, 0);

    const past = await moneySummary(db, addDays(today, -10));
    expect(past.personal.reserved).toBe(0);
    expect(past.personal.reservationsApply).toBe(false);
    expect(past.personal.liquid).toBe(DH(1200));
    expect(past.personal.accounts.map((a) => a.name)).toContain('Old wallet');

    const now = await moneySummary(db);
    expect(now.personal.liquid).toBe(DH(1200));
    expect(now.personal.reserved).toBe(DH(500));
  });

  it('foreign allocations without an exchange rate are not counted', async () => {
    const eur = await personalAccount(db, 'EUR savings', 'savings', 1000, 'EUR');
    const g = await goal('Holiday', 5000);
    await setAllocation(db, { goalId: g, accountId: eur, amountMinor: DH(500) });
    const goals = await listGoals(db);
    expect(goals[0].savedMinor).toBe(0);
    expect(goals[0].unconverted).toEqual(['EUR']);
    expect((await moneySummary(db)).personal.reserved).toBe(0);
  });
});

describe('goal planning', () => {
  it('computes the monthly amount needed and whether the plan is on track', () => {
    const plan = goalPlan({ targetDate: addMonths(today, 10), monthlyPlanMinor: DH(500) }, DH(6000), today);
    expect(plan.monthsLeft).toBe(10);
    expect(plan.neededPerMonthMinor).toBe(DH(600));
    expect(plan.onTrack).toBe(false);
    expect(plan.monthsAtPlan).toBe(12);
    expect(goalPlan({ targetDate: null, monthlyPlanMinor: null }, DH(1), today).neededPerMonthMinor).toBeNull();
  });

  it('validates goals', async () => {
    await expect(createGoal(db, { name: ' ', targetMinor: 100 })).rejects.toThrow(/name/);
    await expect(createGoal(db, { name: 'X', targetMinor: 0 })).rejects.toThrow(/Target/);
  });
});
