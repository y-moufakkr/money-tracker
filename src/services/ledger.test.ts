import { SYSTEM_CATEGORY } from '@/db/seed';
import type { Db } from '@/db/types';
import { addDays, todayISO } from '@/domain/dates';
import { createTestDb } from '@/test/node-db';
import { createAccount, createInstrument, setAccountArchived, updateAccount } from './accounts';
import { accountBalance, accountBalances, accountLedger, moneySummary } from './balances';
import { setRate } from './fx';
import { deleteTransaction, saveExpense, saveIncome, saveTransfer } from './ledger';
import { getTransaction, listTransactions, periodSummary } from './queries';
import { reconcileAccount, recheckReconciliation } from './reconciliation';

const DH = (n: number) => Math.round(n * 100);
const today = todayISO();
const start = addDays(today, -30);

let db: Db;

async function personal(name: string, kind: Parameters<typeof createAccount>[1]['kind'], opening: number, currency = 'MAD') {
  return createAccount(db, {
    name,
    kind,
    ownership: 'personal',
    openingBalanceMinor: DH(opening),
    openingDate: start,
    currency,
  });
}

async function business(name: string, opening: number) {
  return createAccount(db, {
    name,
    kind: 'bank',
    ownership: 'business',
    newCompanyName: 'Zenown SARL',
    openingBalanceMinor: DH(opening),
    openingDate: start,
  });
}

beforeEach(async () => {
  db = await createTestDb();
});

describe('money locations and the personal total', () => {
  it('sums personal locations and keeps company money separate', async () => {
    await personal('Personal bank', 'bank', 20000);
    await personal('Wallet', 'cash', 800);
    await personal('Cash at home', 'cash', 5000);
    await personal('Savings account', 'savings', 15000);
    await business('Company bank', 100000);

    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(40800));
    expect(s.personal.bank).toBe(DH(20000));
    expect(s.personal.cash).toBe(DH(5800));
    expect(s.personal.savings).toBe(DH(15000));
    expect(s.companies).toHaveLength(1);
    expect(s.companies[0].total).toBe(DH(100000));
  });

  it('requires a company for business money', async () => {
    await expect(
      createAccount(db, { name: 'X', kind: 'bank', ownership: 'business', openingBalanceMinor: 0, openingDate: start }),
    ).rejects.toThrow(/company/i);
  });
});

describe('income and expenses', () => {
  it('income increases the destination account', async () => {
    const bank = await personal('Bank', 'bank', 1000);
    await saveIncome(db, { date: today, amountMinor: DH(8000), accountId: bank, categoryId: 'sys-cat-salary' });
    expect(await accountBalance(db, bank)).toBe(DH(9000));
  });

  it('an expense decreases only the paying account', async () => {
    const bank = await personal('Bank', 'bank', 20000);
    const wallet = await personal('Wallet', 'cash', 500);
    await saveExpense(db, {
      date: today,
      amountMinor: DH(100),
      accountId: wallet,
      categoryId: 'sys-cat-groceries',
      merchantName: 'Moul Lkhodra',
    });
    expect(await accountBalance(db, wallet)).toBe(DH(400));
    expect(await accountBalance(db, bank)).toBe(DH(20000));
  });

  it('rejects income categories on expenses and non-positive amounts', async () => {
    const wallet = await personal('Wallet', 'cash', 500);
    await expect(
      saveExpense(db, { date: today, amountMinor: DH(10), accountId: wallet, categoryId: 'sys-cat-salary' }),
    ).rejects.toThrow(/expense category/);
    await expect(saveExpense(db, { date: today, amountMinor: 0, accountId: wallet })).rejects.toThrow(/greater than zero/);
  });

  it('rejects future dates and dates before the opening date', async () => {
    const wallet = await personal('Wallet', 'cash', 500);
    await expect(saveExpense(db, { date: addDays(today, 1), amountMinor: 100, accountId: wallet })).rejects.toThrow(/Future/);
    await expect(saveExpense(db, { date: addDays(start, -1), amountMinor: 100, accountId: wallet })).rejects.toThrow(/starts on/);
  });

  it('reuses merchants case-insensitively and learns their category', async () => {
    const wallet = await personal('Wallet', 'cash', 500);
    await saveExpense(db, { date: today, amountMinor: 100, accountId: wallet, merchantName: 'BIM', categoryId: 'sys-cat-groceries' });
    await saveExpense(db, { date: today, amountMinor: 100, accountId: wallet, merchantName: 'bim ' });
    const rows = await db.all<{ name: string; default_category_id: string }>('SELECT * FROM merchants');
    expect(rows).toHaveLength(1);
    expect(rows[0].default_category_id).toBe('sys-cat-groceries');
  });
});

describe('cards', () => {
  it('debit card payments hit the linked bank account and never add money', async () => {
    const bank = await personal('Bank', 'bank', 20000);
    const card = await createInstrument(db, { name: 'Visa debit', kind: 'debit', accountId: bank });
    expect((await moneySummary(db)).personal.liquid).toBe(DH(20000));

    await saveExpense(db, { date: today, amountMinor: DH(250), instrumentId: card });
    expect(await accountBalance(db, bank)).toBe(DH(19750));
    expect((await moneySummary(db)).personal.liquid).toBe(DH(19750));
  });

  it('a debit card cannot be linked to a credit card account', async () => {
    const cc = await createAccount(db, {
      name: 'CC', kind: 'credit_card', ownership: 'personal', openingBalanceMinor: 0, openingDate: start,
    });
    await expect(createInstrument(db, { name: 'x', kind: 'debit', accountId: cc })).rejects.toThrow(/debit card/);
  });

  it('prepaid cards are their own money location', async () => {
    const bank = await personal('Bank', 'bank', 5000);
    const prepaid = await personal('Prepaid card', 'prepaid', 0);
    await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: prepaid, amountMinor: DH(300) });
    await saveExpense(db, { date: today, amountMinor: DH(120), accountId: prepaid });
    expect(await accountBalance(db, prepaid)).toBe(DH(180));
    expect((await moneySummary(db)).personal.liquid).toBe(DH(4880));
  });

  it('credit card spending is a liability, not negative cash', async () => {
    const bank = await personal('Bank', 'bank', 10000);
    const cc = await createAccount(db, {
      name: 'Credit card', kind: 'credit_card', ownership: 'personal', openingBalanceMinor: DH(-500), openingDate: start,
    });
    await saveExpense(db, { date: today, amountMinor: DH(1000), accountId: cc });
    let s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(10000));
    expect(s.personal.liabilities).toBe(DH(1500));
    expect(s.personal.netLiquid).toBe(DH(8500));

    // Paying the card off is a transfer: liquid falls, liability falls, net position unchanged.
    await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: cc, amountMinor: DH(1500) });
    s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(8500));
    expect(s.personal.liabilities).toBe(0);
    expect(s.personal.netLiquid).toBe(DH(8500));
  });

  it('rejects a positive opening balance on a credit card', async () => {
    await expect(
      createAccount(db, { name: 'CC', kind: 'credit_card', ownership: 'personal', openingBalanceMinor: 100, openingDate: start }),
    ).rejects.toThrow(/owed/);
  });
});

describe('transfers', () => {
  it('preserves total personal money and is not income or expense', async () => {
    const bank = await personal('Bank', 'bank', 20000);
    const wallet = await personal('Wallet', 'cash', 500);
    await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: wallet, amountMinor: DH(1000) });

    expect(await accountBalance(db, bank)).toBe(DH(19000));
    expect(await accountBalance(db, wallet)).toBe(DH(1500));
    expect((await moneySummary(db)).personal.liquid).toBe(DH(20500));

    const p = await periodSummary(db, { from: start, to: today });
    expect(p.incomeMinor).toBe(0);
    expect(p.expenseMinor).toBe(0);
  });

  it('records a fee as a linked expense that is removed with the transfer', async () => {
    const bank = await personal('Bank', 'bank', 1000);
    const savings = await personal('Savings', 'savings', 0);
    const id = await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: savings, amountMinor: DH(500), feeMinor: DH(5) });
    expect(await accountBalance(db, bank)).toBe(DH(495));
    expect(await accountBalance(db, savings)).toBe(DH(500));
    const p = await periodSummary(db, { from: start, to: today });
    expect(p.expenseMinor).toBe(DH(5));
    expect(p.byCategory[0].categoryId).toBe(SYSTEM_CATEGORY.bankFees);

    await deleteTransaction(db, id);
    expect(await accountBalance(db, bank)).toBe(DH(1000));
    expect(await accountBalance(db, savings)).toBe(0);
  });

  it('handles different currencies with an explicit received amount', async () => {
    const eur = await personal('EUR account', 'bank', 1000, 'EUR');
    const mad = await personal('MAD bank', 'bank', 0);
    await expect(
      saveTransfer(db, { date: today, fromAccountId: eur, toAccountId: mad, amountMinor: DH(100) }),
    ).rejects.toThrow(/received/);
    await saveTransfer(db, { date: today, fromAccountId: eur, toAccountId: mad, amountMinor: DH(100), receivedMinor: DH(1085) });
    expect(await accountBalance(db, eur)).toBe(DH(900));
    expect(await accountBalance(db, mad)).toBe(DH(1085));
  });

  it('rejects the same account and mismatched received amount in one currency', async () => {
    const a = await personal('A', 'bank', 100);
    const b = await personal('B', 'cash', 0);
    await expect(saveTransfer(db, { date: today, fromAccountId: a, toAccountId: a, amountMinor: 1 })).rejects.toThrow(/different/);
    await expect(
      saveTransfer(db, { date: today, fromAccountId: a, toAccountId: b, amountMinor: 100, receivedMinor: 90 }),
    ).rejects.toThrow(/same currency/);
  });

  it('is atomic: a failing transfer leaves no partial postings', async () => {
    const a = await personal('A', 'bank', 100);
    const b = await personal('B', 'cash', 0);
    await setAccountArchived(db, b, true, 0);
    await expect(saveTransfer(db, { date: today, fromAccountId: a, toAccountId: b, amountMinor: 50 })).rejects.toThrow(/archived/);
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM postings'))?.n).toBe(0);
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM transactions'))?.n).toBe(0);
  });
});

describe('company ↔ personal separation', () => {
  it('requires a classification for company-to-personal transfers', async () => {
    const company = await business('Company bank', 100000);
    const bank = await personal('Bank', 'bank', 0);
    await expect(
      saveTransfer(db, { date: today, fromAccountId: company, toAccountId: bank, amountMinor: DH(5000) }),
    ).rejects.toThrow(/classified/);
    await expect(
      saveTransfer(db, { date: today, fromAccountId: company, toAccountId: bank, amountMinor: DH(5000), transferClass: 'other' }),
    ).rejects.toThrow(/note/);
  });

  it('counts salary/dividends from the company as personal income, but not reimbursements', async () => {
    const company = await business('Company bank', 100000);
    const bank = await personal('Bank', 'bank', 0);
    await saveTransfer(db, { date: today, fromAccountId: company, toAccountId: bank, amountMinor: DH(8000), transferClass: 'salary' });
    await saveTransfer(db, {
      date: today, fromAccountId: company, toAccountId: bank, amountMinor: DH(700), transferClass: 'expense_reimbursement',
    });

    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(8700));
    expect(s.companies[0].total).toBe(DH(91300));

    const p = await periodSummary(db, { from: start, to: today });
    expect(p.incomeMinor).toBe(DH(8000));
    expect(p.companyIncomeMinor).toBe(DH(8000));

    const biz = await periodSummary(db, { from: start, to: today }, 'business');
    expect(biz.incomeMinor).toBe(0);
  });

  it('business expenses never appear in personal spending', async () => {
    const company = await business('Company bank', 1000);
    await saveExpense(db, { date: today, amountMinor: DH(200), accountId: company, categoryId: 'sys-cat-business' });
    expect((await periodSummary(db, { from: start, to: today })).expenseMinor).toBe(0);
    expect((await periodSummary(db, { from: start, to: today }, 'business')).expenseMinor).toBe(DH(200));
  });

  it('refuses to change ownership after transfers exist', async () => {
    const a = await personal('A', 'bank', 100);
    const b = await personal('B', 'cash', 0);
    await saveTransfer(db, { date: today, fromAccountId: a, toAccountId: b, amountMinor: 10 });
    await expect(
      updateAccount(db, b, {
        name: 'B', kind: 'cash', ownership: 'business', newCompanyName: 'Co', openingBalanceMinor: 0, openingDate: start,
      }),
    ).rejects.toThrow(/Ownership/);
  });
});

describe('editing and deleting', () => {
  it('editing an expense moves it between accounts and recalculates', async () => {
    const wallet = await personal('Wallet', 'cash', 500);
    const bank = await personal('Bank', 'bank', 1000);
    const id = await saveExpense(db, { date: today, amountMinor: DH(100), accountId: wallet });
    await saveExpense(db, { date: today, amountMinor: DH(150), accountId: bank }, id);
    expect(await accountBalance(db, wallet)).toBe(DH(500));
    expect(await accountBalance(db, bank)).toBe(DH(850));
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM postings'))?.n).toBe(1);
  });

  it('editing a transfer can add and remove its fee', async () => {
    const a = await personal('A', 'bank', 1000);
    const b = await personal('B', 'cash', 0);
    const id = await saveTransfer(db, { date: today, fromAccountId: a, toAccountId: b, amountMinor: DH(100), feeMinor: DH(2) });
    await saveTransfer(db, { date: today, fromAccountId: a, toAccountId: b, amountMinor: DH(100) }, id);
    expect(await accountBalance(db, a)).toBe(DH(900));
    expect((await getTransaction(db, id))?.fees).toHaveLength(0);
  });

  it('deletion removes the effect on balances and hides the transaction', async () => {
    const wallet = await personal('Wallet', 'cash', 500);
    const id = await saveExpense(db, { date: today, amountMinor: DH(100), accountId: wallet });
    await deleteTransaction(db, id);
    expect(await accountBalance(db, wallet)).toBe(DH(500));
    expect(await listTransactions(db)).toHaveLength(0);
    await expect(saveExpense(db, { date: today, amountMinor: 1, accountId: wallet }, id)).rejects.toThrow(/not found/);
  });

  it('a transfer fee cannot be edited on its own', async () => {
    const a = await personal('A', 'bank', 1000);
    const b = await personal('B', 'cash', 0);
    const id = await saveTransfer(db, { date: today, fromAccountId: a, toAccountId: b, amountMinor: 100, feeMinor: 5 });
    const feeId = (await getTransaction(db, id))!.fees[0].id;
    await expect(saveExpense(db, { date: today, amountMinor: 1, accountId: a }, feeId)).rejects.toThrow(/Edit the transfer/);
  });

  it('cannot move the opening date after existing transactions', async () => {
    const wallet = await personal('Wallet', 'cash', 500);
    await saveExpense(db, { date: addDays(today, -10), amountMinor: 100, accountId: wallet });
    await expect(
      updateAccount(db, wallet, { name: 'Wallet', kind: 'cash', ownership: 'personal', openingBalanceMinor: DH(500), openingDate: today }),
    ).rejects.toThrow(/opening date/);
  });

  it('only archives empty locations', async () => {
    const wallet = await personal('Wallet', 'cash', 500);
    await expect(setAccountArchived(db, wallet, true, DH(500))).rejects.toThrow(/remaining balance/);
  });
});

describe('historical balances', () => {
  it('computes balances as of a past date', async () => {
    const bank = await personal('Bank', 'bank', 1000);
    await saveIncome(db, { date: addDays(today, -20), amountMinor: DH(500), accountId: bank });
    await saveExpense(db, { date: addDays(today, -5), amountMinor: DH(200), accountId: bank });

    expect(await accountBalance(db, bank, addDays(today, -25))).toBe(DH(1000));
    expect(await accountBalance(db, bank, addDays(today, -10))).toBe(DH(1500));
    expect(await accountBalance(db, bank, today)).toBe(DH(1300));
    // Before the location was opened it does not exist.
    expect(await accountBalances(db, { asOf: addDays(start, -1) })).toHaveLength(0);
  });

  it('produces a running balance ledger', async () => {
    const bank = await personal('Bank', 'bank', 1000);
    await saveIncome(db, { date: addDays(today, -2), amountMinor: DH(500), accountId: bank });
    await saveExpense(db, { date: addDays(today, -1), amountMinor: DH(200), accountId: bank });
    const account = (await accountBalances(db)).find((a) => a.id === bank)!;
    const lines = await accountLedger(db, account);
    expect(lines.map((l) => l.balanceAfterMinor)).toEqual([DH(1300), DH(1500)]);
  });
});

describe('reconciliation', () => {
  it('records a matched check without touching the ledger', async () => {
    const bank = await personal('Bank', 'bank', 4500);
    const r = await reconcileAccount(db, { accountId: bank, date: today, statementBalanceMinor: DH(4500), action: 'adjust' });
    expect(r.status).toBe('matched');
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM transactions'))?.n).toBe(0);
  });

  it('records an explicit adjustment that is neither income nor expense', async () => {
    const bank = await personal('Bank', 'bank', 4500);
    const r = await reconcileAccount(db, { accountId: bank, date: today, statementBalanceMinor: DH(4400), action: 'adjust' });
    expect(r.status).toBe('adjusted');
    expect(r.differenceMinor).toBe(DH(-100));
    expect(await accountBalance(db, bank)).toBe(DH(4400));

    const p = await periodSummary(db, { from: start, to: today });
    expect(p.incomeMinor).toBe(0);
    expect(p.expenseMinor).toBe(0);
    expect(p.adjustmentsMinor).toBe(DH(-100));
  });

  it('leaves a difference open for investigation, then resolves it once the missing expense is recorded', async () => {
    const bank = await personal('Bank', 'bank', 4500);
    const r = await reconcileAccount(db, { accountId: bank, date: today, statementBalanceMinor: DH(4400), action: 'investigate' });
    expect(r.status).toBe('open');
    expect(await accountBalance(db, bank)).toBe(DH(4500));

    await saveExpense(db, { date: today, amountMinor: DH(100), accountId: bank, note: 'Forgotten bank fee' });
    const again = await recheckReconciliation(db, r.id, false);
    expect(again.status).toBe('matched');
    expect(await accountBalance(db, bank)).toBe(DH(4400));
  });

  it('deleting an adjustment re-opens the reconciliation', async () => {
    const bank = await personal('Bank', 'bank', 4500);
    const r = await reconcileAccount(db, { accountId: bank, date: today, statementBalanceMinor: DH(4400), action: 'adjust' });
    await deleteTransaction(db, r.adjustmentTransactionId!);
    const row = await db.first<{ status: string }>('SELECT status FROM reconciliations WHERE id = ?', [r.id]);
    expect(row?.status).toBe('open');
    expect(await accountBalance(db, bank)).toBe(DH(4500));
  });
});

describe('currency conversion in totals', () => {
  it('converts foreign accounts with a known rate and flags those without', async () => {
    await personal('MAD bank', 'bank', 1000);
    await personal('EUR cash', 'cash', 100, 'EUR');
    await personal('USD account', 'bank', 50, 'USD');
    await setRate(db, 'EUR', 10_850_000, start);

    const s = await moneySummary(db);
    expect(s.personal.liquid).toBe(DH(1000) + DH(1085));
    expect(s.personal.unconverted.map((a) => a.currency)).toEqual(['USD']);
  });
});

describe('itemized purchases', () => {
  it('stores items and products without changing the paid amount', async () => {
    const wallet = await personal('Wallet', 'cash', 500);
    const id = await saveExpense(db, {
      date: today,
      amountMinor: DH(100),
      accountId: wallet,
      merchantName: 'Moul Lkhodra',
      items: [
        { lineKind: 'product', name: 'Tomatoes', quantityMilli: 2000, unit: 'kg', unitPriceMinor: DH(10), totalMinor: DH(20) },
        { lineKind: 'product', name: 'Potatoes', quantityMilli: 3000, unit: 'kg', unitPriceMinor: DH(7), totalMinor: DH(21) },
        { lineKind: 'product', name: 'Onions', quantityMilli: 1000, unit: 'kg', unitPriceMinor: DH(8), totalMinor: DH(8) },
        { lineKind: 'unallocated', name: 'Other vegetables', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: DH(51) },
      ],
    });
    expect(await accountBalance(db, wallet)).toBe(DH(400));
    const t = await getTransaction(db, id);
    expect(t?.items).toHaveLength(4);
    expect(t?.items[3].productId).toBeNull();
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM products'))?.n).toBe(3);
  });

  it('allows incomplete items but rejects a discount without an amount', async () => {
    const wallet = await personal('Wallet', 'cash', 500);
    await saveExpense(db, {
      date: today, amountMinor: DH(30), accountId: wallet,
      items: [{ lineKind: 'product', name: 'Bread', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: null }],
    });
    await expect(
      saveExpense(db, {
        date: today, amountMinor: DH(30), accountId: wallet,
        items: [{ lineKind: 'discount', name: 'Promo', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: null }],
      }),
    ).rejects.toThrow(/needs an amount/);
  });
});
