import type { Db } from '@/db/types';
import { addDays, daysBetweenInclusive, startOfMonth, startOfWeek } from '@/domain/dates';
import type { Budget } from '@/domain/types';
import { createTestDb } from '@/test/node-db';
import { DH, personalAccount, today } from '@/test/fixtures';
import { loadExpenseFacts } from './analytics';
import { budgetRange, budgetStatuses, computeBudgetStatus, deleteBudget, listBudgets, saveBudget } from './budgets';
import { createCategory } from './catalog';
import { budgetInsights } from './insights';
import { saveExpense } from './ledger';

let db: Db;
let wallet: string;

beforeEach(async () => {
  db = await createTestDb();
  wallet = await personalAccount(db, 'Wallet', 'cash', 20000);
});

const spend = (amount: number, categoryId: string | null, date = today) =>
  saveExpense(db, { date, amountMinor: DH(amount), accountId: wallet, categoryId });

const budget = (over: Partial<Budget>): Budget => ({
  id: 'b',
  name: 'Monthly',
  period: 'custom',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  amountMinor: DH(8000),
  currency: 'MAD',
  thresholds: [75, 90, 100],
  isArchived: false,
  lines: [],
  ...over,
});

describe('budget vs actual', () => {
  it('computes remaining, % used, days left and a linear projection', () => {
    const facts = [
      { date: '2026-10-05', amountMinor: DH(3000), categoryId: 'g' },
      { date: '2026-10-20', amountMinor: DH(3480), categoryId: null },
      { date: '2026-11-01', amountMinor: DH(999), categoryId: null }, // outside the period
    ] as Parameters<typeof computeBudgetStatus>[1];
    const s = computeBudgetStatus(budget({}), facts, { from: '2026-10-01', to: '2026-10-31' }, [], '2026-10-27');
    expect(s.total.spentMinor).toBe(DH(6480));
    expect(s.total.remainingMinor).toBe(DH(1520));
    expect(s.total.usedRatio).toBeCloseTo(0.81);
    expect(s.total.thresholdReached).toBe(75);
    expect(s.daysTotal).toBe(31);
    expect(s.daysElapsed).toBe(27);
    expect(s.daysLeft).toBe(5);
    // 6,480 ÷ 27 × 31 = 7,440 DH
    expect(s.total.projectedMinor).toBe(DH(7440));
    expect(s.projectedOver).toBe(false);

    const later = computeBudgetStatus(budget({}), facts, { from: '2026-10-01', to: '2026-10-31' }, [], '2026-11-03');
    expect(later.daysLeft).toBe(0);
    expect(later.total.projectedMinor).toBe(DH(6480));
    const before = computeBudgetStatus(budget({}), [], { from: '2026-10-01', to: '2026-10-31' }, [], '2026-09-20');
    expect(before.daysElapsed).toBe(0);
    expect(before.daysLeft).toBe(31);
  });

  it('category lines cover subcategories without their own line, so lines never overlap', () => {
    const cats = [
      { id: 'groceries', name: 'Groceries', parentId: null, color: null, icon: null },
      { id: 'baby', name: 'Baby food', parentId: 'groceries', color: null, icon: null },
      { id: 'veg', name: 'Vegetables', parentId: 'groceries', color: null, icon: null },
      { id: 'fuel', name: 'Petrol', parentId: null, color: null, icon: null },
    ];
    const facts = [
      { date: '2026-10-02', amountMinor: DH(1000), categoryId: 'groceries' },
      { date: '2026-10-03', amountMinor: DH(300), categoryId: 'veg' },
      { date: '2026-10-04', amountMinor: DH(200), categoryId: 'baby' },
      { date: '2026-10-05', amountMinor: DH(900), categoryId: 'fuel' },
      { date: '2026-10-06', amountMinor: DH(100), categoryId: null },
    ] as Parameters<typeof computeBudgetStatus>[1];
    const b = budget({
      lines: [
        { id: '1', categoryId: 'groceries', amountMinor: DH(3300) },
        { id: '2', categoryId: 'baby', amountMinor: DH(400) },
      ],
    });
    const s = computeBudgetStatus(b, facts, { from: '2026-10-01', to: '2026-10-31' }, cats, '2026-10-10');
    expect(s.lines.map((l) => [l.name, l.spentMinor])).toEqual([
      ['Groceries', DH(1300)],
      ['Baby food', DH(200)],
    ]);
    expect(s.other).toMatchObject({ budgetMinor: DH(8000 - 3700), spentMinor: DH(1000), coveredByLinesMinor: DH(1500) });
    expect(s.lines.reduce((x, l) => x + l.spentMinor, 0) + s.other!.spentMinor).toBe(s.total.spentMinor);
  });

  it('without an overall limit, the total is the sum of the lines', () => {
    const s = computeBudgetStatus(
      budget({ amountMinor: null, lines: [{ id: '1', categoryId: 'x', amountMinor: DH(500) }] }),
      [],
      { from: '2026-10-01', to: '2026-10-31' },
      [],
      '2026-10-10',
    );
    expect(s.total.budgetMinor).toBe(DH(500));
    expect(s.other).toBeNull();
  });

  it('reports threshold warnings and over-budget lines as insights', () => {
    const facts = [{ date: '2026-10-02', amountMinor: DH(950), categoryId: 'x' }] as Parameters<typeof computeBudgetStatus>[1];
    const s = computeBudgetStatus(
      budget({ amountMinor: DH(1000), lines: [{ id: '1', categoryId: 'x', amountMinor: DH(900) }] }),
      facts,
      { from: '2026-10-01', to: '2026-10-31' },
      [{ id: 'x', name: 'Petrol', parentId: null, color: null, icon: null }],
      '2026-10-10',
    );
    expect(s.total.thresholdReached).toBe(90);
    const list = budgetInsights([s]);
    expect(list[0].title).toBe('Monthly: 95% used with 22 days left');
    expect(list[0].calculation).toContain('950 DH ÷ 10 days elapsed × 31 days = 2,945 DH');
    expect(list[1].title).toBe('Petrol is over its monthly limit');
  });
});

describe('budgets in the database', () => {
  it('uses this week or this month for recurring budgets', () => {
    expect(budgetRange({ period: 'monthly', startDate: null, endDate: null }, today).from).toBe(startOfMonth(today));
    const week = budgetRange({ period: 'weekly', startDate: null, endDate: null }, today);
    expect(week.from).toBe(startOfWeek(today));
    expect(daysBetweenInclusive(week.from, week.to)).toBe(7);
  });

  it('measures actual spending from transactions; changing a budget never changes them', async () => {
    const sub = await createCategory(db, { name: 'Veg', kind: 'expense', parentId: 'sys-cat-groceries' });
    await spend(500, 'sys-cat-groceries');
    await spend(120, sub);
    await spend(80, 'sys-cat-petrol');
    await spend(999, 'sys-cat-petrol', addDays(startOfMonth(today), -1)); // last month
    const snapshot = async () => ({
      tx: await db.all('SELECT id, amount_minor, category_id, date, updated_at FROM transactions ORDER BY id'),
      postings: await db.all('SELECT * FROM postings ORDER BY id'),
    });
    const before = await snapshot();

    const id = await saveBudget(db, {
      name: 'Monthly',
      period: 'monthly',
      amountMinor: DH(8000),
      lines: [{ categoryId: 'sys-cat-groceries', amountMinor: DH(3300) }],
    });
    let [s] = await budgetStatuses(db, today);
    expect(s.total.spentMinor).toBe(DH(700));
    expect(s.lines[0].spentMinor).toBe(DH(620));
    expect(s.other?.spentMinor).toBe(DH(80));

    await saveBudget(
      db,
      { name: 'Tighter', period: 'monthly', amountMinor: DH(600), thresholds: [50, 100], lines: [] },
      id,
    );
    [s] = await budgetStatuses(db, today);
    expect(s.total.spentMinor).toBe(DH(700));
    expect(s.total.thresholdReached).toBe(100);
    expect(s.lines).toHaveLength(0);
    expect(await snapshot()).toEqual(before);

    const facts = await loadExpenseFacts(db, budgetRange(s.budget, today));
    expect(facts.facts.reduce((x, f) => x + f.amountMinor, 0)).toBe(DH(700));

    await deleteBudget(db, id);
    expect(await listBudgets(db)).toHaveLength(0);
    expect(await snapshot()).toEqual(before);
  });

  it('validates budgets', async () => {
    const base = { name: 'B', period: 'monthly' as const, amountMinor: DH(100), lines: [] };
    await expect(saveBudget(db, { ...base, amountMinor: null })).rejects.toThrow(/at least one/);
    await expect(saveBudget(db, { ...base, period: 'custom' })).rejects.toThrow(/start and an end/);
    await expect(saveBudget(db, { ...base, thresholds: [90, 75] })).rejects.toThrow(/increasing/);
    await expect(
      saveBudget(db, { ...base, lines: [{ categoryId: 'sys-cat-salary', amountMinor: 100 }] }),
    ).rejects.toThrow(/expense categories/);
    await expect(
      saveBudget(db, {
        ...base,
        lines: [
          { categoryId: 'sys-cat-gym', amountMinor: 100 },
          { categoryId: 'sys-cat-gym', amountMinor: 200 },
        ],
      }),
    ).rejects.toThrow(/once/);
    expect(await listBudgets(db)).toHaveLength(0);
  });
});
