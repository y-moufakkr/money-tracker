import type { Db } from '@/db/types';
import { addDays, addMonths } from '@/domain/dates';
import { createTestDb } from '@/test/node-db';
import { businessAccount, count, DH, personalAccount, start, today } from '@/test/fixtures';
import { createAccount, deleteAccount } from './accounts';
import { accountBalance, moneySummary, reserveBills } from './balances';
import { getDebt, saveDebt } from './debts';
import { createGoal, setAllocation } from './goals';
import { deleteTransaction, saveExpense } from './ledger';
import { periodSummary } from './queries';
import {
  adjustOccurrence,
  deleteExpected,
  deleteRule,
  getRule,
  linkOccurrence,
  listOccurrences,
  occurrenceCandidates,
  payOccurrence,
  reopenOccurrence,
  saveExpected,
  saveRule,
  setRulePaused,
  skipOccurrence,
  upcomingOccurrences,
  type RuleInput,
} from './recurring';

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

const monthly = (accountId: string, over: Partial<RuleInput> = {}): RuleInput => ({
  name: 'Internet',
  direction: 'expense',
  amountMinor: DH(300),
  accountId,
  categoryId: 'sys-cat-internet',
  payee: 'Maroc Telecom',
  intervalUnit: 'month',
  intervalCount: 1,
  startDate: addDays(today, 5),
  ...over,
});

describe('recurring bills', () => {
  it('expected bills never change a balance; they are reserved, so available falls but liquid does not', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    await saveRule(db, monthly(bank));
    await saveRule(db, monthly(bank, { name: 'Electricity', amountMinor: DH(450), startDate: addDays(today, 40) }));

    expect(await accountBalance(db, bank)).toBe(DH(10000));
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(10000));
    // Only the bill due within 30 days is reserved.
    expect(s.personal.reservedBills).toBe(DH(300));
    expect(s.personal.reserved).toBe(DH(300));
    expect(s.personal.available).toBe(DH(9700));
    expect(s.personal.netLiquid).toBe(DH(10000));

    const upcoming = await upcomingOccurrences(db);
    expect(upcoming.map((o) => [o.name, o.dueDate, o.status])).toEqual([['Internet', addDays(today, 5), 'pending']]);
    expect(upcoming[0].dueSoon).toBe(false);
  });

  it('paying a reserved bill at its expected amount leaves available unchanged and records the real expense', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const rule = await saveRule(db, monthly(bank));
    const before = await moneySummary(db);
    const txId = await payOccurrence(db, { ref: { ruleId: rule, dueDate: addDays(today, 5) }, date: today, amountMinor: DH(300) });

    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(9700));
    expect(s.personal.reservedBills).toBe(0);
    expect(s.personal.available).toBe(before.personal.available);
    expect((await periodSummary(db, { from: start, to: today })).expenseMinor).toBe(DH(300));
    const t = await db.first<{ category_id: string; note: string }>('SELECT category_id, note FROM transactions WHERE id = ?', [txId]);
    expect(t).toEqual({ category_id: 'sys-cat-internet', note: 'Internet' });

    // Paid once only.
    await expect(payOccurrence(db, { ref: { ruleId: rule, dueDate: addDays(today, 5) }, date: today, amountMinor: DH(300) })).rejects.toThrow(/already/);
    // The next month is the next pending occurrence.
    expect((await getRule(db, rule))!.next!.dueDate).toBe(addMonths(addDays(today, 5), 1));

    // Deleting the expense re-opens the bill and its reservation.
    await deleteTransaction(db, txId);
    expect((await moneySummary(db)).personal.reservedBills).toBe(DH(300));
    expect((await upcomingOccurrences(db))[0].status).toBe('pending');
  });

  it('bills are reserved after goals and never beyond what the location holds', async () => {
    const savings = await personalAccount(db, 'Savings', 'savings', 1000);
    const goal = await createGoal(db, { name: 'Emergency', targetMinor: DH(5000) });
    await setAllocation(db, { goalId: goal, accountId: savings, amountMinor: DH(800) });
    await saveRule(db, monthly(savings, { amountMinor: DH(300) }));
    const s = await moneySummary(db);
    expect(s.personal.reservedGoals).toBe(DH(800));
    expect(s.personal.reservedBills).toBe(DH(200));
    expect(s.personal.available).toBe(0);
    expect(s.personal.reserved + s.personal.available).toBe(s.personal.liquid);
    expect(s.personal.billsShort).toHaveLength(1);
    expect(s.personal.billsShort[0]).toMatchObject({ dueMinor: DH(300), shortMinor: DH(100) });

    expect(reserveBills(-500, 0, DH(300))).toEqual({ backedMinor: 0, shortMinor: DH(300) });
  });

  it('overdue bills stay reserved until paid or skipped; skipping releases them and can be undone', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const rule = await saveRule(db, monthly(bank, { startDate: addDays(today, -40) }));
    const overdue = await upcomingOccurrences(db);
    expect(overdue.filter((o) => o.overdue)).toHaveLength(2);
    expect((await getRule(db, rule))!.overdueCount).toBe(2);
    expect((await moneySummary(db)).personal.reservedBills).toBe(DH(300 * 2 + (overdue.length - 2) * 300));

    await skipOccurrence(db, overdue[0].ref, 'Paid at the shop, not recorded');
    const after = await upcomingOccurrences(db);
    expect(after).toHaveLength(overdue.length - 1);
    await reopenOccurrence(db, overdue[0].ref);
    expect(await upcomingOccurrences(db)).toHaveLength(overdue.length);
    // A plain reopen leaves no stored row behind.
    expect(await count(db, 'SELECT COUNT(*) AS n FROM expected_payments')).toBe(1);
  });

  it('links an expense recorded earlier; a transaction settles one expected payment only', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const a = await saveRule(db, monthly(bank));
    const b = await saveRule(db, monthly(bank, { name: 'Phone', categoryId: 'sys-cat-mobile' }));
    const exp = await saveExpense(db, { date: today, amountMinor: DH(310), accountId: bank, categoryId: 'sys-cat-internet' });
    const ref = { ruleId: a, dueDate: addDays(today, 5) };
    expect((await occurrenceCandidates(db, ref))[0].transactionId).toBe(exp);
    await linkOccurrence(db, ref, exp);
    const paid = (await listOccurrences(db, { from: today, to: addDays(today, 10), ruleId: a }))[0];
    expect(paid).toMatchObject({ status: 'paid', transactionId: exp, paidMinor: DH(310), amountMinor: DH(300) });
    await expect(linkOccurrence(db, { ruleId: b, dueDate: addDays(today, 5) }, exp)).rejects.toThrow(/already settles/);
    expect(await occurrenceCandidates(db, { ruleId: b, dueDate: addDays(today, 5) })).toEqual([]);

    // Unlinking keeps the expense.
    await reopenOccurrence(db, ref);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL')).toBe(1);
    expect((await listOccurrences(db, { from: today, to: addDays(today, 10), ruleId: a }))[0].status).toBe('pending');
  });

  it('adjusts one occurrence, and a schedule change drops adjustments that are no longer on it but keeps history', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const input = monthly(bank, { name: 'Electricity', startDate: addDays(today, -20) });
    const rule = await saveRule(db, input);
    const [first, second] = await listOccurrences(db, { from: addDays(today, -20), to: addDays(today, 50), ruleId: rule });
    await payOccurrence(db, { ref: first.ref, date: today, amountMinor: DH(280) });
    await adjustOccurrence(db, second.ref, DH(520), 'Summer AC');
    expect((await moneySummary(db)).personal.reservedBills).toBe(DH(520));

    await saveRule(db, { ...input, startDate: addDays(input.startDate, 3) }, rule);
    const list = await listOccurrences(db, { from: addDays(today, -30), to: addDays(today, 50), ruleId: rule });
    expect(list.find((o) => o.dueDate === first.dueDate)?.status).toBe('paid');
    expect(list.some((o) => o.adjusted)).toBe(false);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM expected_payments')).toBe(1);
  });

  it('paused rules reserve nothing and have nothing due', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const rule = await saveRule(db, monthly(bank, { startDate: addDays(today, -40) }));
    await setRulePaused(db, rule, true);
    expect(await upcomingOccurrences(db)).toEqual([]);
    expect((await moneySummary(db)).personal.reservedBills).toBe(0);
    expect((await getRule(db, rule))!.next).toBeNull();
    await setRulePaused(db, rule, false);
    expect((await upcomingOccurrences(db)).length).toBeGreaterThan(0);
  });

  it('a bill on a credit card is listed but not reserved (the card holds no money)', async () => {
    const cc = await createAccount(db, { name: 'Card', kind: 'credit_card', ownership: 'personal', openingBalanceMinor: 0, openingDate: start });
    await personalAccount(db, 'Bank', 'bank', 1000);
    await saveRule(db, monthly(cc, { name: 'Streaming', amountMinor: DH(90) }));
    expect(await upcomingOccurrences(db)).toHaveLength(1);
    const s = await moneySummary(db);
    expect(s.personal.reservedBills).toBe(0);
    expect(s.personal.billsShort).toEqual([]);
  });

  it('recurring payments are personal; categories must match; locations in use cannot be deleted', async () => {
    const company = await businessAccount(db, 'Company', 1000);
    await expect(saveRule(db, monthly(company))).rejects.toThrow(/personal/);
    const bank = await personalAccount(db, 'Bank', 'bank', 0);
    await expect(saveRule(db, monthly(bank, { categoryId: 'sys-cat-salary' }))).rejects.toThrow(/expense category/);
    await expect(saveRule(db, monthly(bank, { endDate: addDays(today, -1) }))).rejects.toThrow(/end date/);
    const empty = await personalAccount(db, 'Empty', 'cash', 0);
    const rule = await saveRule(db, monthly(empty));
    await expect(deleteAccount(db, empty)).rejects.toThrow(/Recurring/);
    await deleteRule(db, rule);
    await deleteAccount(db, empty);
  });
});

describe('expected income', () => {
  it('is a projection: shown, never added to liquid or available, and becomes money only when received', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 1000);
    const rule = await saveRule(db, {
      name: 'Salary',
      direction: 'income',
      amountMinor: DH(15000),
      accountId: bank,
      categoryId: 'sys-cat-salary',
      intervalUnit: 'month',
      intervalCount: 1,
      startDate: addDays(today, 3),
    });
    let s = await moneySummary(db);
    expect(s.personal.expectedIncome).toBe(DH(15000));
    expect(s.personal.liquid).toBe(DH(1000));
    expect(s.personal.available).toBe(DH(1000));
    expect(s.personal.reservedBills).toBe(0);
    expect((await periodSummary(db, { from: start, to: today })).incomeMinor).toBe(0);

    await payOccurrence(db, { ref: { ruleId: rule, dueDate: addDays(today, 3) }, date: today, amountMinor: DH(15200) });
    s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(16200));
    expect(s.personal.expectedIncome).toBe(0);
    expect((await periodSummary(db, { from: start, to: today })).incomeMinor).toBe(DH(15200));
  });
});

describe('loan installments', () => {
  it('paying an installment records a repayment (principal) plus interest, and lowers the debt', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 20000);
    const debt = await saveDebt(db, { direction: 'owe', counterparty: 'Car loan', principalMinor: DH(24000), startDate: addDays(today, -30) });
    const rule = await saveRule(db, monthly(bank, { name: 'Car loan', amountMinor: DH(2100), categoryId: null, debtId: debt }));
    const before = await moneySummary(db);
    expect(before.personal.reservedBills).toBe(DH(2100));
    expect(before.personal.debtLiabilities).toBe(DH(24000));

    await payOccurrence(db, { ref: { ruleId: rule, dueDate: addDays(today, 5) }, date: today, amountMinor: DH(2000), interestMinor: DH(100) });
    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(17900));
    expect(s.personal.debtLiabilities).toBe(DH(22000));
    expect(s.personal.reservedBills).toBe(0);
    // Net position falls by the interest only.
    expect(s.personal.netLiquid).toBe(before.personal.netLiquid - DH(100));
    expect((await periodSummary(db, { from: start, to: today })).expenseMinor).toBe(DH(100));
    expect((await getDebt(db, debt))!.paidMinor).toBe(DH(2000));
  });

  it('a rule repaying a debt must go the debt’s way and use its currency', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 0);
    const eur = await personalAccount(db, 'Euro', 'bank', 0, 'EUR');
    const owed = await saveDebt(db, { direction: 'owed', counterparty: 'Ahmed', principalMinor: DH(1000), startDate: today });
    await expect(saveRule(db, monthly(bank, { debtId: owed, categoryId: null }))).rejects.toThrow(/expected income/);
    const owe = await saveDebt(db, { direction: 'owe', counterparty: 'Bank', principalMinor: DH(1000), startDate: today });
    await expect(saveRule(db, monthly(eur, { debtId: owe, categoryId: null }))).rejects.toThrow(/MAD/);
  });
});

describe('one-off expected payments', () => {
  it('reserves a large upcoming bill, can be paid, and only unpaid one-offs can be edited', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const id = await saveExpected(db, { name: 'Car insurance', direction: 'expense', amountMinor: DH(3200), accountId: bank, dueDate: addDays(today, 20) });
    expect((await moneySummary(db)).personal.reservedBills).toBe(DH(3200));
    await payOccurrence(db, { ref: { expectedId: id }, date: today, amountMinor: DH(3150) });
    const s = await moneySummary(db);
    expect(s.personal.reservedBills).toBe(0);
    expect(s.personal.liquid).toBe(DH(6850));
    await expect(saveExpected(db, { name: 'Car insurance', direction: 'expense', amountMinor: DH(1), accountId: bank, dueDate: today }, id)).rejects.toThrow(/settled/);
    await reopenOccurrence(db, { expectedId: id });
    expect((await upcomingOccurrences(db))[0].transactionId).toBeNull();
    await deleteExpected(db, id);
    expect(await upcomingOccurrences(db)).toEqual([]);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL')).toBe(1);
  });
});
