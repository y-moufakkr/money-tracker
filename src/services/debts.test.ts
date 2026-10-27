import type { Db } from '@/db/types';
import { SYSTEM_CATEGORY } from '@/db/seed';
import { addDays } from '@/domain/dates';
import { createTestDb } from '@/test/node-db';
import { businessAccount, count, DH, personalAccount, start, today } from '@/test/fixtures';
import { createAccount } from './accounts';
import { loadExpenseFacts } from './analytics';
import { accountBalance, moneySummary } from './balances';
import { debtsOutstanding, getDebt, linkRepayment, recordRepayment, repaymentCandidates, saveDebt, setDebtClosed, deleteDebt, unlinkRepayment } from './debts';
import { exportEntries, totalsOf } from './export';
import { deleteTransaction, saveDebtMovement, saveExpense, saveIncome } from './ledger';
import { periodSummary } from './queries';

let db: Db;
const range = { from: start, to: today };

beforeEach(async () => {
  db = await createTestDb();
});

/** Income, spending and analytics facts: loan principal must never appear in any of them. */
async function flows() {
  const p = await periodSummary(db, range);
  const facts = await loadExpenseFacts(db, range);
  return { income: p.incomeMinor, expense: p.expenseMinor, facts: facts.facts.length };
}

describe('debts I owe', () => {
  it('borrowing raises cash and liabilities by the same amount: net position, income and spending unchanged', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const before = await moneySummary(db);
    const id = await saveDebt(db, { direction: 'owe', counterparty: 'Brother', principalMinor: DH(5000), startDate: today, originAccountId: bank });

    expect(await accountBalance(db, bank)).toBe(DH(15000));
    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(15000));
    expect(s.personal.debtLiabilities).toBe(DH(5000));
    expect(s.personal.liabilities).toBe(DH(5000));
    expect(s.personal.netLiquid).toBe(before.personal.netLiquid);
    expect(await flows()).toEqual({ income: 0, expense: 0, facts: 0 });

    const d = await getDebt(db, id);
    expect(d).toMatchObject({ outstandingMinor: DH(5000), status: 'open', currency: 'MAD', originAccount: { id: bank } });
  });

  it('a repayment lowers cash and the debt; only the interest is an expense', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const id = await saveDebt(db, { direction: 'owe', counterparty: 'Car loan', principalMinor: DH(6000), startDate: addDays(today, -60), originAccountId: bank });
    const txId = await recordRepayment(db, { debtId: id, accountId: bank, date: today, amountMinor: DH(1000), interestMinor: DH(80) });

    expect(await accountBalance(db, bank)).toBe(DH(10000 + 6000 - 1000 - 80));
    const d = await getDebt(db, id);
    expect(d).toMatchObject({ paidMinor: DH(1000), outstandingMinor: DH(5000), status: 'partial' });
    expect(d!.payments.map((p) => p.transactionId)).toEqual([txId]);
    const s = await moneySummary(db);
    expect(s.personal.debtLiabilities).toBe(DH(5000));
    // Net position falls by the interest only.
    expect(s.personal.netLiquid).toBe(DH(10000 - 80));
    const f = await flows();
    expect(f.expense).toBe(DH(80));
    expect(f.income).toBe(0);
    const interest = await db.first<{ category_id: string; parent_id: string }>('SELECT category_id, parent_id FROM transactions WHERE kind = ?', ['expense']);
    expect(interest).toEqual({ category_id: SYSTEM_CATEGORY.loanInterest, parent_id: txId });

    // Deleting the repayment re-opens the debt and removes the interest with it.
    await deleteTransaction(db, txId);
    expect((await getDebt(db, id))!.outstandingMinor).toBe(DH(6000));
    expect(await accountBalance(db, bank)).toBe(DH(16000));
    expect((await flows()).expense).toBe(0);
  });

  it('refuses repaying more than is outstanding, and repayments on a closed debt', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const id = await saveDebt(db, { direction: 'owe', counterparty: 'Friend', principalMinor: DH(500), startDate: today });
    await expect(recordRepayment(db, { debtId: id, accountId: bank, date: today, amountMinor: DH(501) })).rejects.toThrow(/Only 500/);
    await setDebtClosed(db, id, true, 'Forgiven');
    await expect(recordRepayment(db, { debtId: id, accountId: bank, date: today, amountMinor: DH(100) })).rejects.toThrow(/closed/);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
  });

  it('a debt with no money movement (they paid for me) is a liability; repaying it with an expense counts the purchase once', async () => {
    const wallet = await personalAccount(db, 'Wallet', 'cash', 4000);
    const id = await saveDebt(db, { direction: 'owe', counterparty: 'Brother', principalMinor: DH(3000), startDate: today, notes: 'Plane ticket' });
    let s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(4000));
    expect(s.personal.debtLiabilities).toBe(DH(3000));
    expect(s.personal.netLiquid).toBe(DH(1000));

    const ticket = await saveExpense(db, { date: today, amountMinor: DH(3000), accountId: wallet, categoryId: 'sys-cat-transport', note: 'Ticket, repaid to brother' });
    await linkRepayment(db, { debtId: id, transactionId: ticket });
    s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(1000));
    expect(s.personal.debtLiabilities).toBe(0);
    expect(s.personal.netLiquid).toBe(DH(1000));
    expect((await flows()).expense).toBe(DH(3000));
    expect((await getDebt(db, id))!.status).toBe('paid');
  });

  it('a transaction repays one debt only, and the starting movement cannot repay anything', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const a = await saveDebt(db, { direction: 'owe', counterparty: 'A', principalMinor: DH(1000), startDate: today, originAccountId: bank });
    const b = await saveDebt(db, { direction: 'owe', counterparty: 'B', principalMinor: DH(1000), startDate: today });
    const out = await saveDebtMovement(db, { date: today, accountId: bank, amountMinor: DH(400), direction: 'out' });
    await linkRepayment(db, { debtId: b, transactionId: out });
    await expect(linkRepayment(db, { debtId: a, transactionId: out })).rejects.toThrow(/another debt/);
    const origin = (await getDebt(db, a))!.originTransactionId!;
    await expect(linkRepayment(db, { debtId: b, transactionId: origin })).rejects.toThrow(/outgoing|start/);
    expect((await repaymentCandidates(db, a)).map((c) => c.transactionId)).not.toContain(out);
    // Unlinking keeps the money movement but the debt is outstanding again.
    const paymentId = (await getDebt(db, b))!.payments[0].id;
    await unlinkRepayment(db, paymentId);
    expect((await getDebt(db, b))!.outstandingMinor).toBe(DH(1000));
    expect(await accountBalance(db, bank)).toBe(DH(10000 + 1000 - 400));
  });

  it('editing the debt rewrites its starting movement, so balance and debt always agree', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const wallet = await personalAccount(db, 'Wallet', 'cash', 0);
    const input = { direction: 'owe' as const, counterparty: 'Brother', principalMinor: DH(5000), startDate: today, originAccountId: bank };
    const id = await saveDebt(db, input);
    await saveDebt(db, { ...input, principalMinor: DH(4000), originAccountId: wallet }, id);
    expect(await accountBalance(db, bank)).toBe(DH(10000));
    expect(await accountBalance(db, wallet)).toBe(DH(4000));
    expect(await count(db, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'debt' AND deleted_at IS NULL")).toBe(1);

    await recordRepayment(db, { debtId: id, accountId: wallet, date: today, amountMinor: DH(1500) });
    await expect(saveDebt(db, { ...input, principalMinor: DH(1000), originAccountId: wallet }, id)).rejects.toThrow(/already repaid/);

    // No money moved after all: the movement is removed, the debt stays.
    await saveDebt(db, { ...input, originAccountId: null }, id);
    expect(await accountBalance(db, wallet)).toBe(DH(4000 - 4000 - 1500));
    const d = await getDebt(db, id);
    expect(d).toMatchObject({ originTransactionId: null, outstandingMinor: DH(3500) });
  });

  it('deleting the starting transaction keeps the debt; deleting the debt keeps the money movements', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 1000);
    const id = await saveDebt(db, { direction: 'owe', counterparty: 'Bank loan', principalMinor: DH(2000), startDate: today, originAccountId: bank });
    const pay = await recordRepayment(db, { debtId: id, accountId: bank, date: today, amountMinor: DH(500) });
    await deleteTransaction(db, (await getDebt(db, id))!.originTransactionId!);
    expect(await getDebt(db, id)).toMatchObject({ originTransactionId: null, outstandingMinor: DH(1500) });
    expect(await accountBalance(db, bank)).toBe(DH(500));

    await deleteDebt(db, id);
    expect(await getDebt(db, id)).toBeNull();
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions WHERE id = ? AND deleted_at IS NULL', [pay])).toBe(1);
    expect(await accountBalance(db, bank)).toBe(DH(500));
    expect((await moneySummary(db)).personal.debtLiabilities).toBe(0);
  });

  it('debts are personal and need a location that holds money', async () => {
    const company = await businessAccount(db, 'Company bank', 100000);
    const cc = await createAccount(db, { name: 'Card', kind: 'credit_card', ownership: 'personal', openingBalanceMinor: 0, openingDate: start });
    await expect(saveDebt(db, { direction: 'owe', counterparty: 'X', principalMinor: DH(100), startDate: today, originAccountId: company })).rejects.toThrow(/personal/);
    await expect(saveDebt(db, { direction: 'owe', counterparty: 'X', principalMinor: DH(100), startDate: today, originAccountId: cc })).rejects.toThrow(/credit card/);
    await expect(saveDebt(db, { direction: 'owe', counterparty: ' ', principalMinor: DH(100), startDate: today })).rejects.toThrow(/Who/);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM debts')).toBe(0);
  });
});

describe('money owed to me', () => {
  it('lending lowers cash; the receivable is never counted as money', async () => {
    const wallet = await personalAccount(db, 'Wallet', 'cash', 3000);
    const id = await saveDebt(db, { direction: 'owed', counterparty: 'Ahmed', principalMinor: DH(2000), startDate: today, dueDate: addDays(today, 30), originAccountId: wallet });
    let s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(1000));
    expect(s.personal.available).toBe(DH(1000));
    expect(s.personal.receivables).toBe(DH(2000));
    expect(s.personal.netLiquid).toBe(DH(1000));
    expect(s.personal.liabilities).toBe(0);
    expect(await flows()).toEqual({ income: 0, expense: 0, facts: 0 });

    await recordRepayment(db, { debtId: id, accountId: wallet, date: today, amountMinor: DH(1500) });
    s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(2500));
    expect(s.personal.receivables).toBe(DH(500));
    expect((await flows()).income).toBe(0);
    await expect(recordRepayment(db, { debtId: id, accountId: wallet, date: today, amountMinor: DH(1), interestMinor: DH(1) })).rejects.toThrow(/Interest/);
  });

  it('income can be linked as a repayment (sold something on credit); expenses cannot', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 0);
    const id = await saveDebt(db, { direction: 'owed', counterparty: 'Buyer', principalMinor: DH(1200), startDate: today });
    const exp = await saveExpense(db, { date: today, amountMinor: DH(50), accountId: bank });
    await expect(linkRepayment(db, { debtId: id, transactionId: exp })).rejects.toThrow(/income/);
    const inc = await saveIncome(db, { date: today, amountMinor: DH(2000), accountId: bank });
    await linkRepayment(db, { debtId: id, transactionId: inc });
    // Only what was owed is linked; the rest of the income is not a repayment.
    expect((await getDebt(db, id))!.payments[0].amountMinor).toBe(DH(1200));
    expect((await getDebt(db, id))!.status).toBe('paid');
  });

  it('closing a debt stops counting it from that date; reopening restores it', async () => {
    await personalAccount(db, 'Bank', 'bank', 0);
    const id = await saveDebt(db, { direction: 'owed', counterparty: 'Old friend', principalMinor: DH(700), startDate: addDays(today, -100) });
    await setDebtClosed(db, id, true, 'Written off', `${addDays(today, -10)}T10:00:00.000Z`);
    expect((await moneySummary(db)).personal.receivables).toBe(0);
    expect((await getDebt(db, id))!.status).toBe('closed');
    // Before it was closed, it still counted.
    expect((await debtsOutstanding(db, addDays(today, -20))).map((d) => d.outstandingMinor)).toEqual([DH(700)]);
    await setDebtClosed(db, id, false);
    expect((await moneySummary(db)).personal.receivables).toBe(DH(700));
  });
});

describe('debts over time and in exports', () => {
  it('past dates show what was outstanding then', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 10000);
    const id = await saveDebt(db, { direction: 'owe', counterparty: 'Loan', principalMinor: DH(3000), startDate: addDays(today, -30), originAccountId: bank });
    await recordRepayment(db, { debtId: id, accountId: bank, date: addDays(today, -10), amountMinor: DH(1000) });
    expect((await moneySummary(db, addDays(today, -31))).personal.debtLiabilities).toBe(0);
    expect((await moneySummary(db, addDays(today, -20))).personal.debtLiabilities).toBe(DH(3000));
    const now = await moneySummary(db);
    expect(now.personal.debtLiabilities).toBe(DH(2000));
    expect(now.personal.netLiquid).toBe(DH(10000));
  });

  it('exports loan principal on its own lines, never as income, spending or transfers', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 1000);
    const id = await saveDebt(db, { direction: 'owe', counterparty: 'Brother', principalMinor: DH(5000), startDate: today, originAccountId: bank });
    await recordRepayment(db, { debtId: id, accountId: bank, date: today, amountMinor: DH(2000), interestMinor: DH(100) });
    const entries = await exportEntries(db, { from: start, to: today, scope: 'personal', categoryIds: null });
    const [t] = totalsOf(entries);
    expect(t).toMatchObject({ incomeMinor: 0, expensesMinor: DH(100), transfersInMinor: 0, transfersOutMinor: 0, debtInMinor: DH(5000), debtOutMinor: DH(2000) });
    expect(t.netChangeMinor).toBe(DH(5000 - 2000 - 100));
  });
});
