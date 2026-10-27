import { addDays, todayISO } from '@/domain/dates';
import { createAccount } from '@/services/accounts';
import { accountBalance, accountBalances, moneySummary } from '@/services/balances';
import { createTag } from '@/services/catalog';
import { saveExpense, saveTransfer } from '@/services/ledger';
import { getTransaction, periodSummary } from '@/services/queries';
import { createTestDb } from '@/test/node-db';
import { migrate, SCHEMA_VERSION } from './migrations';

const today = todayISO();
const start = addDays(today, -10);
const version = async (db: Awaited<ReturnType<typeof createTestDb>>) =>
  (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version;

describe('migrations', () => {
  it('upgrades a v1 database that already has data to v2 without changing it', async () => {
    const db = await createTestDb(1);
    expect(await version(db)).toBe(1);
    expect(await db.first("SELECT name FROM sqlite_master WHERE name = 'tags'")).toBeNull();

    const bank = await createAccount(db, { name: 'Bank', kind: 'bank', ownership: 'personal', openingBalanceMinor: 2_000_000, openingDate: start });
    const wallet = await createAccount(db, { name: 'Wallet', kind: 'cash', ownership: 'personal', openingBalanceMinor: 80_000, openingDate: start });
    const expenseId = await saveExpense(db, {
      date: today,
      amountMinor: 10_000,
      accountId: wallet,
      categoryId: 'sys-cat-veg-fruit',
      merchantName: 'Moul Lkhodra',
      items: [{ lineKind: 'product', name: 'Tomatoes', quantityMilli: 2000, unit: 'kg', unitPriceMinor: 1000, totalMinor: 2000 }],
    });
    await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: wallet, amountMinor: 50_000, feeMinor: 500 });
    const before = {
      balances: await accountBalances(db),
      period: await periodSummary(db, { from: start, to: today }),
      rows: await db.all('SELECT * FROM transactions ORDER BY id'),
      postings: await db.all('SELECT * FROM postings ORDER BY id'),
      items: await db.all('SELECT * FROM purchase_items ORDER BY id'),
      categories: await db.all('SELECT * FROM categories ORDER BY id'),
    };

    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await version(db)).toBe(2);

    expect(await db.all('SELECT * FROM transactions ORDER BY id')).toEqual(before.rows);
    expect(await db.all('SELECT * FROM postings ORDER BY id')).toEqual(before.postings);
    expect(await db.all('SELECT * FROM purchase_items ORDER BY id')).toEqual(before.items);
    expect(await db.all('SELECT * FROM categories ORDER BY id')).toEqual(before.categories);
    expect(await accountBalances(db)).toEqual(before.balances);
    const after = await moneySummary(db);
    expect(after.personal.liquid).toBe(2_000_000 - 50_500 + 80_000 - 10_000 + 50_000);
    expect(after.personal.reserved).toBe(0);
    expect(await periodSummary(db, { from: start, to: today })).toEqual(before.period);
    expect(await accountBalance(db, wallet)).toBe(80_000 - 10_000 + 50_000);

    // New tables work on upgraded data.
    for (const t of ['tags', 'transaction_tags', 'item_tags', 'budgets', 'budget_lines', 'savings_goals', 'goal_allocations']) {
      expect(await db.first(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [t])).not.toBeNull();
    }
    const tag = await createTag(db, { name: 'Market' });
    const t = await getTransaction(db, expenseId);
    await saveExpense(db, { date: today, amountMinor: 10_000, accountId: wallet, items: t!.items, tagIds: [tag] }, expenseId);
    expect((await getTransaction(db, expenseId))?.tags.map((x) => x.name)).toEqual(['Market']);

    // Running migrations again is a no-op.
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await version(db)).toBe(2);
  });

  it('refuses a database from a newer app version', async () => {
    const db = await createTestDb();
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toThrow(/newer than this app/);
  });
});
