import { addDays, todayISO } from '@/domain/dates';
import { createAccount } from '@/services/accounts';
import { accountBalance, accountBalances, moneySummary } from '@/services/balances';
import { createTag } from '@/services/catalog';
import { fiscalYearBounds, saveFiscalYear } from '@/services/company';
import { createGoal, setAllocation } from '@/services/goals';
import { saveExpense, saveIncome, saveTransfer } from '@/services/ledger';
import { saveDebt } from '@/services/debts';
import { saveLiability } from '@/services/obligations';
import { backupStatus, getSyncMeta } from '@/services/backup';
import { companyDashboard, threeTotals } from '@/services/overview';
import { getTransaction, periodSummary } from '@/services/queries';
import { dumpData, populate } from '@/test/fixtures';
import { createTestDb } from '@/test/node-db';
import { migrate, SCHEMA_VERSION } from './migrations';
import { COMPANY_CATEGORIES, SYSTEM_CATEGORY } from './seed';

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

    expect(await migrate(db, 2)).toBe(2);
    expect(await version(db)).toBe(2);

    expect(await db.all('SELECT * FROM transactions ORDER BY id')).toEqual(before.rows);
    expect(await db.all('SELECT * FROM postings ORDER BY id')).toEqual(before.postings);
    expect(await db.all('SELECT * FROM purchase_items ORDER BY id')).toEqual(before.items);
    expect(await db.all('SELECT * FROM categories ORDER BY id')).toEqual(before.categories);
    expect(await accountBalances(db)).toEqual(before.balances);
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
    expect(await migrate(db, 2)).toBe(2);
    expect(await version(db)).toBe(2);

    // Today's services see the same money once the database is current.
    await migrate(db);
    const after = await moneySummary(db);
    expect(after.personal.liquid).toBe(2_000_000 - 50_500 + 80_000 - 10_000 + 50_000);
    expect(after.personal.reserved).toBe(0);
  });

  it('upgrades a v2 database that already has data to v3 without changing it', async () => {
    const db = await createTestDb(2);
    expect(await version(db)).toBe(2);
    const personal = await createAccount(db, { name: 'Bank', kind: 'bank', ownership: 'personal', openingBalanceMinor: 2_000_000, openingDate: start });
    const company = await createAccount(db, {
      name: 'Company bank',
      kind: 'bank',
      ownership: 'business',
      newCompanyName: 'Zenown SARL',
      openingBalanceMinor: 10_000_000,
      openingDate: start,
    });
    await saveIncome(db, { date: today, amountMinor: 5_000_000, accountId: company });
    await saveExpense(db, { date: today, amountMinor: 1_000_000, accountId: company, categoryId: 'sys-cat-business' });
    await saveTransfer(db, { date: today, fromAccountId: company, toAccountId: personal, amountMinor: 800_000, transferClass: 'salary' });
    await saveTransfer(db, { date: today, fromAccountId: company, toAccountId: personal, amountMinor: 300_000, transferClass: 'dividend' });
    const goal = await createGoal(db, { name: 'Emergency', targetMinor: 1_000_000 });
    await setAllocation(db, { goalId: goal, accountId: personal, amountMinor: 500_000 });
    const snapshot = async () => ({
      balances: await accountBalances(db),
      personal: await periodSummary(db, { from: start, to: today }),
      business: await periodSummary(db, { from: start, to: today }, 'business'),
      rows: await db.all('SELECT * FROM transactions ORDER BY id'),
      postings: await db.all('SELECT * FROM postings ORDER BY id'),
      categories: await db.all('SELECT * FROM categories ORDER BY id'),
      goals: await db.all('SELECT * FROM goal_allocations ORDER BY id'),
    });
    const before = await snapshot();

    expect(await migrate(db, 3)).toBe(3);
    expect(await version(db)).toBe(3);

    const after = await snapshot();
    expect(after.balances).toEqual(before.balances);
    expect(after.rows).toEqual(before.rows);
    expect(after.postings).toEqual(before.postings);
    expect(after.goals).toEqual(before.goals);
    expect(after.personal).toEqual(before.personal);
    expect(after.business).toEqual(before.business);
    // Company records gain settings.
    expect(await db.first('SELECT tva_mode, fiscal_year_start_month, ownership_bp FROM companies')).toEqual({
      tva_mode: 'ttc',
      fiscal_year_start_month: 1,
      ownership_bp: 10000,
    });
    // Existing categories are untouched; the company categories are added once.
    expect(after.categories.filter((c) => !(c as { id: string }).id.startsWith('sys-cat-co-'))).toEqual(before.categories);
    expect(after.categories).toHaveLength(before.categories.length + COMPANY_CATEGORIES.length);

    // The new features work on upgraded data (brought to the latest version, as the app does),
    // and the old dividend shows as unmatched.
    expect(await migrate(db, 3)).toBe(3);
    await migrate(db);
    const summary = await moneySummary(db);
    expect(summary.personal.liquid).toBe(2_000_000 + 800_000 + 300_000);
    expect(summary.personal.reserved).toBe(500_000);
    expect(summary.companies[0].total).toBe(10_000_000 + 5_000_000 - 1_000_000 - 800_000 - 300_000);
    const companyId = summary.companies[0].company.id;
    const fy = fiscalYearBounds(1, today);
    await saveFiscalYear(db, { companyId, label: fy.label, startDate: fy.startDate, endDate: fy.endDate });
    await saveLiability(db, { companyId, kind: 'tva', label: 'TVA', amountMinor: 200_000 });
    const dash = await companyDashboard(db, companyId);
    expect(dash!.position.cashMinor).toBe(10_000_000 + 5_000_000 - 1_000_000 - 800_000 - 300_000);
    expect(dash!.position.liquidityMinor).toBe(dash!.position.cashMinor - 200_000);
    expect(dash!.checks.map((c) => c.id)).toContain('dividend-without-approval');
    expect((await moneySummary(db)).personal).toEqual(summary.personal);
  });

  it('upgrades a v3 database with company obligations and distributions to v4 without changing it', async () => {
    const db = await createTestDb(3);
    const ids = await populate(db);
    const snapshot = async () => ({
      data: await dumpData(db),
      balances: await accountBalances(db),
      personal: await periodSummary(db, { from: start, to: today }),
      business: await periodSummary(db, { from: start, to: today }, 'business'),
    });
    const before = await snapshot();

    expect(await migrate(db, 4)).toBe(4);
    expect(await version(db)).toBe(4);
    expect(await snapshot()).toEqual(before);

    // One device row with a stable id; the existing data counts as never backed up.
    const meta = await getSyncMeta(db);
    expect(meta.deviceId).toMatch(/^[0-9a-f]{32}$/);
    expect(meta).toMatchObject({ changeSeq: 0, baselineSeq: null, lastBackupAt: null, keepBackups: 10 });
    expect((await backupStatus(db)).unbackedChanges).toBe(true);
    expect(await db.all('SELECT * FROM backups')).toEqual([]);

    // Writes on the upgraded data are tracked, including company records.
    await saveLiability(db, { companyId: ids.companyId, kind: 'is', label: 'IS advance', amountMinor: 700_000 });
    const after = await getSyncMeta(db);
    expect(after.changeSeq).toBeGreaterThan(0);
    expect(after.deviceId).toBe(meta.deviceId);
    expect(await migrate(db, 4)).toBe(4);
    expect((await getSyncMeta(db)).deviceId).toBe(meta.deviceId);
  });

  it('upgrades a v4 database to v5: the transactions rebuild keeps every row, link, index and trigger', async () => {
    const db = await createTestDb(4);
    const ids = await populate(db);
    // A soft-deleted transaction and a linked fee must survive the rebuild too.
    const fee = await saveTransfer(db, { date: today, fromAccountId: ids.bank, toAccountId: ids.wallet, amountMinor: 10_000, feeMinor: 500 });
    await db.run('UPDATE transactions SET deleted_at = ? WHERE id = ?', [`${today}T12:00:00.000Z`, ids.groceries]);
    const schema = async () =>
      db.all<{ type: string; name: string; sql: string }>(
        `SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'transactions' AND type IN ('index','trigger') ORDER BY name`,
      );
    const snapshot = async () => ({
      data: await dumpData(db),
      balances: await accountBalances(db),
      personal: await periodSummary(db, { from: start, to: today }),
      business: await periodSummary(db, { from: start, to: today }, 'business'),
    });
    const before = await snapshot();
    const indexes = await schema();
    const seq = (await getSyncMeta(db)).changeSeq;

    expect(await migrate(db, 5)).toBe(5);
    expect(await version(db)).toBe(5);
    const after = await snapshot();
    // Same rows in the same order; the only new data is the "Loan interest" category.
    const { categories: catsAfter, companies: cosAfter, ...restAfter } = after.data;
    const { categories: catsBefore, companies: cosBefore, ...restBefore } = before.data;
    expect(restAfter).toEqual({ ...restBefore, debts: [], debt_payments: [], recurring_rules: [], expected_payments: [] });
    // Companies keep every value and default to the detailed payout estimate.
    expect(cosAfter).toEqual(cosBefore.map((c) => ({ ...(c as object), payout_mode: 'detailed', simple_payout_bp: null })));
    expect(catsAfter.filter((c) => (c as { id: string }).id !== SYSTEM_CATEGORY.loanInterest)).toEqual(catsBefore);
    expect(after.balances).toEqual(before.balances);
    expect(after.personal).toEqual(before.personal);
    expect(after.business).toEqual(before.business);
    // Summaries work on the rebuilt table: the populated goal reservation and company cash are intact.
    const summary = await moneySummary(db);
    expect(summary.personal.reservedGoals).toBe(500_000);
    expect(summary.personal.debtLiabilities).toBe(0);
    expect((await companyDashboard(db, ids.companyId))!.position.cashMinor).toBe(summary.companies[0].total);
    expect((await threeTotals(db)).a.liquidMinor).toBe(summary.personal.liquid);
    expect(await schema()).toEqual(indexes);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect((await db.first<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys).toBe(1);
    // References to transactions still point at the rebuilt table and still cascade/restrict.
    expect(await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE parent_id = ?', [fee])).toEqual({ n: 1 });
    await expect(db.run("UPDATE postings SET transaction_id = 'missing' WHERE transaction_id = ?", [fee])).rejects.toThrow(/FOREIGN KEY/);
    // The rebuild itself is not a change; the one new category row is (one bump).
    expect((await getSyncMeta(db)).changeSeq).toBe(seq + 1);
    await saveExpense(db, { date: today, amountMinor: 1_000, accountId: ids.wallet });
    expect((await getSyncMeta(db)).changeSeq).toBeGreaterThan(seq + 1);
    // The new kind is accepted.
    await saveDebt(db, { direction: 'owe', counterparty: 'Brother', principalMinor: 50_000, startDate: today, originAccountId: ids.bank });
    expect(await migrate(db, 5)).toBe(5);
  });

  it('refuses a database from a newer app version', async () => {
    const db = await createTestDb();
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toThrow(/newer than this app/);
  });
});
