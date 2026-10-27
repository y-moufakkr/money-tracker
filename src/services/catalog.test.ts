import { SYSTEM_CATEGORY } from '@/db/seed';
import type { Db } from '@/db/types';
import { addDays } from '@/domain/dates';
import { createTestDb } from '@/test/node-db';
import { count, DH, personalAccount, today } from '@/test/fixtures';
import { listMerchants, productDetail } from './analytics';
import { saveBudget, listBudgets } from './budgets';
import {
  createCategory,
  createTag,
  deleteTag,
  listAllCategories,
  listTags,
  mergeCategory,
  mergeMerchant,
  mergeProduct,
  mergeTag,
  renameMerchant,
  renameProduct,
  setCategoryArchived,
  updateCategory,
} from './catalog';
import { saveExpense } from './ledger';
import { getTransaction, listCategories, listTransactions, periodSummary } from './queries';

let db: Db;
let wallet: string;
const month = { from: addDays(today, -30), to: today };

beforeEach(async () => {
  db = await createTestDb();
  wallet = await personalAccount(db, 'Wallet', 'cash', 5000);
});

const spend = (amount: number, extra: Partial<Parameters<typeof saveExpense>[1]> = {}) =>
  saveExpense(db, { date: today, amountMinor: DH(amount), accountId: wallet, ...extra });

describe('category hierarchy', () => {
  it('creates subcategories one level deep, within one kind', async () => {
    const snacks = await createCategory(db, { name: 'Wife snacks', kind: 'expense', parentId: 'sys-cat-snacks' });
    const cats = await listAllCategories(db, 'expense');
    expect(cats.find((c) => c.id === snacks)?.parentId).toBe('sys-cat-snacks');
    // Inherits the parent's look when none is given.
    expect(cats.find((c) => c.id === snacks)?.icon).toBe('cookie');

    await expect(createCategory(db, { name: 'Deeper', kind: 'expense', parentId: snacks })).rejects.toThrow(/one level/);
    await expect(createCategory(db, { name: 'Bad', kind: 'income', parentId: 'sys-cat-snacks' })).rejects.toThrow(/same type/);
    await expect(
      updateCategory(db, 'sys-cat-snacks', { name: 'Snacks', parentId: 'sys-cat-groceries' }),
    ).rejects.toThrow(/has subcategories/);
    await expect(updateCategory(db, snacks, { name: 'X', parentId: snacks })).rejects.toThrow(/own parent/);
  });

  it('renames without touching history', async () => {
    const id = await spend(30, { categoryId: 'sys-cat-snacks' });
    await updateCategory(db, 'sys-cat-snacks', { name: 'Treats', essential: false });
    expect((await getTransaction(db, id))?.category?.name).toBe('Treats');
    expect((await getTransaction(db, id))?.amountMinor).toBe(DH(30));
  });

  it('archiving hides a category from pickers but keeps its transactions', async () => {
    const id = await spend(30, { categoryId: 'sys-cat-gym' });
    await setCategoryArchived(db, 'sys-cat-gym', true);
    expect((await listCategories(db, 'expense')).some((c) => c.id === 'sys-cat-gym')).toBe(false);
    expect((await getTransaction(db, id))?.category?.name).toBe('Gym');
    expect((await periodSummary(db, month)).expenseMinor).toBe(DH(30));
    await expect(setCategoryArchived(db, SYSTEM_CATEGORY.bankFees, true)).rejects.toThrow(/used by the app/);
  });
});

describe('merging categories keeps history', () => {
  it('moves transactions, items, defaults, subcategories and budget lines to the target', async () => {
    const meat = 'sys-cat-meat-fish';
    const groceries = 'sys-cat-groceries';
    const sub = await createCategory(db, { name: 'Poultry', kind: 'expense', parentId: meat });
    await spend(100, { categoryId: meat, merchantName: 'Butcher' });
    await spend(40, { categoryId: groceries });
    await spend(25, { categoryId: sub });
    await saveBudget(db, {
      name: 'Monthly',
      period: 'monthly',
      amountMinor: DH(8000),
      lines: [
        { categoryId: meat, amountMinor: DH(500) },
        { categoryId: groceries, amountMinor: DH(3300) },
      ],
    });
    const before = await periodSummary(db, month);

    await mergeCategory(db, meat, groceries);

    const after = await periodSummary(db, month);
    expect(after.expenseMinor).toBe(before.expenseMinor);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions')).toBe(3);
    expect(after.byCategory.find((c) => c.categoryId === groceries)?.totalMinor).toBe(DH(140));
    expect(await count(db, 'SELECT COUNT(*) AS n FROM categories WHERE id = ?', [meat])).toBe(0);
    expect((await listAllCategories(db, 'expense')).find((c) => c.id === sub)?.parentId).toBe(groceries);
    const merchant = await db.first<{ default_category_id: string }>("SELECT default_category_id FROM merchants WHERE name = 'Butcher'");
    expect(merchant?.default_category_id).toBe(groceries);
    const [budget] = await listBudgets(db);
    expect(budget.lines).toEqual([expect.objectContaining({ categoryId: groceries, amountMinor: DH(3800) })]);
  });

  it('refuses unsafe merges', async () => {
    await expect(mergeCategory(db, SYSTEM_CATEGORY.bankFees, 'sys-cat-groceries')).rejects.toThrow(/used by the app/);
    await expect(mergeCategory(db, 'sys-cat-groceries', 'sys-cat-salary')).rejects.toThrow(/Both categories/);
    const sub = await createCategory(db, { name: 'Poultry', kind: 'expense', parentId: 'sys-cat-meat-fish' });
    await expect(mergeCategory(db, 'sys-cat-meat-fish', sub)).rejects.toThrow(/subcategory/);
  });
});

describe('merchants and products', () => {
  it('renames and merges merchants without losing visits', async () => {
    await spend(50, { merchantName: 'Marjan' });
    await spend(70, { merchantName: 'Marjane' });
    const [a, b] = await db.all<{ id: string; name: string }>('SELECT id, name FROM merchants ORDER BY name');
    await expect(renameMerchant(db, a.id, 'marjane')).rejects.toThrow(/Merge/);
    await mergeMerchant(db, a.id, b.id);
    const merchants = await listMerchants(db);
    expect(merchants).toHaveLength(1);
    expect(merchants[0]).toMatchObject({ name: 'Marjane', visits: 2, totalMinor: DH(120), averageTicketMinor: DH(60) });
    await renameMerchant(db, b.id, 'Marjane Hay Riad');
    expect((await listTransactions(db)).every((t) => t.merchantName === 'Marjane Hay Riad')).toBe(true);
  });

  it('merges products and keeps every recorded line as entered', async () => {
    const item = (name: string, qty: number, unit: string, total: number) => ({
      lineKind: 'product' as const, name, quantityMilli: qty, unit, unitPriceMinor: null, totalMinor: DH(total),
    });
    await spend(124, { items: [item('Chicken breast', 2000, 'kg', 124)] });
    await spend(34, { items: [item('Blanc de poulet', 500_000, 'g', 34)] });
    const [poulet, chicken] = await db.all<{ id: string }>('SELECT id FROM products ORDER BY name');
    await mergeProduct(db, poulet.id, chicken.id);
    await renameProduct(db, chicken.id, 'Chicken');

    const p = await productDetail(db, chicken.id);
    expect(p?.name).toBe('Chicken');
    expect(p?.stats.purchaseCount).toBe(2);
    expect(p?.stats.lines.map((l) => l.unit)).toEqual(['kg', 'g']);
    expect(p?.stats.groups[0].quantityMicro).toBe(2_500_000);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM products')).toBe(1);
  });
});

describe('tags', () => {
  it('creates tags case-insensitively and attaches them to expenses and items', async () => {
    const a = await createTag(db, { name: 'Wife snacks' });
    expect(await createTag(db, { name: 'wife SNACKS' })).toBe(a);
    const b = await createTag(db, { name: 'Weekend' });
    const id = await spend(80, {
      tagIds: [a, b, a],
      items: [{ lineKind: 'product', name: 'Chips', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: DH(20), tagIds: [b] }],
    });
    const t = await getTransaction(db, id);
    expect(t?.tags.map((x) => x.name)).toEqual(['Weekend', 'Wife snacks']);
    expect(t?.items[0].tagIds).toEqual([b]);

    // Editing without tagIds keeps the tags; items are rewritten with theirs.
    await saveExpense(db, { date: today, amountMinor: DH(90), accountId: wallet, items: t!.items }, id);
    expect((await getTransaction(db, id))?.tags).toHaveLength(2);
    expect((await getTransaction(db, id))?.items[0].tagIds).toEqual([b]);
    await saveExpense(db, { date: today, amountMinor: DH(90), accountId: wallet, tagIds: [] }, id);
    expect((await getTransaction(db, id))?.tags).toHaveLength(0);
  });

  it('rejects unknown tags atomically', async () => {
    await expect(spend(10, { tagIds: ['nope'] })).rejects.toThrow(/Tag not found/);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
  });

  it('merging tags keeps one link per transaction; deleting never changes amounts', async () => {
    const a = await createTag(db, { name: 'Snacks (me)' });
    const b = await createTag(db, { name: 'My snacks' });
    await spend(10, { tagIds: [a, b] });
    await spend(20, { tagIds: [a] });
    await mergeTag(db, a, b);
    const tags = await listTags(db);
    expect(tags).toEqual([expect.objectContaining({ id: b, transactionCount: 2 })]);
    await deleteTag(db, b);
    expect((await periodSummary(db, month)).expenseMinor).toBe(DH(30));
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transaction_tags')).toBe(0);
  });
});
