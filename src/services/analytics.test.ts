import type { Db } from '@/db/types';
import { addDays } from '@/domain/dates';
import type { PurchaseItemInput } from '@/domain/types';
import { createTestDb } from '@/test/node-db';
import { businessAccount, DH, personalAccount, today } from '@/test/fixtures';
import { applyFilter, breakdown, drillFilter, loadExpenseFacts, loadProductLines, productDetail, productStats } from './analytics';
import { createCategory, createTag } from './catalog';
import { productInsights, spendingInsights } from './insights';
import { saveExpense } from './ledger';
import { listTransactions, NO_CATEGORY, NO_TAG, periodSummary } from './queries';

let db: Db;
let wallet: string;
const range = { from: addDays(today, -30), to: today };

beforeEach(async () => {
  db = await createTestDb();
  wallet = await personalAccount(db, 'Wallet', 'cash', 10000);
});

const spend = (amount: number, extra: Partial<Parameters<typeof saveExpense>[1]> = {}) =>
  saveExpense(db, { date: today, amountMinor: DH(amount), accountId: wallet, ...extra });

const item = (name: string, total: number | null, extra: Partial<PurchaseItemInput> = {}): PurchaseItemInput => ({
  lineKind: 'product',
  name,
  quantityMilli: null,
  unit: null,
  unitPriceMinor: null,
  totalMinor: total === null ? null : DH(total),
  ...extra,
});

describe('tags never double count totals', () => {
  it('shows a transaction under each of its tags but counts it once in the total', async () => {
    const wife = await createTag(db, { name: 'Wife snacks' });
    const weekend = await createTag(db, { name: 'Weekend' });
    const t1 = await spend(100, { tagIds: [wife, weekend] });
    await spend(50, { tagIds: [wife] });
    // Only part of this receipt is tagged.
    await spend(80, { items: [item('Chips', 30, { tagIds: [weekend] }), item('Bread', 50)] });
    // Tagged at both levels: the transaction tag wins, the item is not added again.
    await spend(40, { tagIds: [weekend], items: [item('Soda', 15, { tagIds: [weekend, wife] })] });

    const facts = await loadExpenseFacts(db, range);
    const b = breakdown(applyFilter(facts.facts, null), 'tag', facts.tags);
    const row = (key: string) => b.rows.find((r) => r.key === key)?.totalMinor;
    expect(b.totalMinor).toBe(DH(270));
    expect(row(wife)).toBe(DH(100 + 50 + 15));
    expect(row(weekend)).toBe(DH(100 + 30 + 40));
    expect(row(NO_TAG)).toBe(DH(50));
    expect(b.overlapping).toBe(true);
    // Every dirham is either tagged or untagged, once.
    expect((await periodSummary(db, range)).expenseMinor).toBe(DH(270));

    const onlyWeekend = applyFilter(facts.facts, { kind: 'tag', id: weekend, label: 'Weekend' });
    expect(onlyWeekend.reduce((s, f) => s + f.scopedMinor, 0)).toBe(DH(170));
    // Breaking a tag down by category never exceeds the tag's total.
    expect(breakdown(onlyWeekend, 'category', facts.tags).totalMinor).toBe(DH(170));

    const drilled = await listTransactions(db, drillFilter(range, null, { tagId: weekend })!);
    expect(drilled).toHaveLength(3);
    expect(drilled.some((t) => t.id === t1)).toBe(true);
    expect(await listTransactions(db, { tagId: NO_TAG })).toHaveLength(0);
  });

  it('caps item-tagged amounts at what was paid', async () => {
    const tag = await createTag(db, { name: 'Gym diet' });
    await spend(20, { items: [item('Protein', 35, { tagIds: [tag] })] });
    const facts = await loadExpenseFacts(db, range);
    const b = breakdown(applyFilter(facts.facts, null), 'tag', facts.tags);
    expect(b.rows.find((r) => r.key === tag)?.totalMinor).toBe(DH(20));
  });
});

describe('breakdowns and drill-down', () => {
  it('rolls subcategories into their parent and lists them separately by subcategory', async () => {
    const sub = await createCategory(db, { name: 'Wife snacks', kind: 'expense', parentId: 'sys-cat-snacks' });
    await spend(30, { categoryId: 'sys-cat-snacks' });
    await spend(20, { categoryId: sub });
    await spend(15);
    const facts = await loadExpenseFacts(db, range);
    const scoped = applyFilter(facts.facts, null);

    const byCat = breakdown(scoped, 'category', facts.tags);
    expect(byCat.rows.map((r) => [r.label, r.totalMinor])).toEqual([
      ['Snacks', DH(50)],
      ['Uncategorised', DH(15)],
    ]);
    const bySub = breakdown(scoped, 'subcategory', facts.tags);
    expect(bySub.rows.map((r) => r.label)).toEqual(['Snacks', 'Snacks › Wife snacks', 'Uncategorised']);

    const parent = await listTransactions(db, drillFilter(range, null, byCat.rows[0].drill)!);
    expect(parent).toHaveLength(2);
    // The Phase 1 gap: "Uncategorised" now drills into exactly the uncategorised expenses.
    const none = await listTransactions(db, drillFilter(range, null, byCat.rows[1].drill)!);
    expect(none.map((t) => t.amountMinor)).toEqual([DH(15)]);
    expect(await listTransactions(db, { categoryId: NO_CATEGORY })).toHaveLength(1);
  });

  it('splits essential and discretionary spending, with subcategories inheriting', async () => {
    const sub = await createCategory(db, { name: 'Baby food', kind: 'expense', parentId: 'sys-cat-groceries' });
    await spend(100, { categoryId: sub });
    await spend(60, { categoryId: 'sys-cat-restaurants' });
    await spend(25, { categoryId: 'sys-cat-gym' });
    const facts = await loadExpenseFacts(db, range);
    const b = breakdown(applyFilter(facts.facts, null), 'essential', facts.tags);
    expect(Object.fromEntries(b.rows.map((r) => [r.key, r.totalMinor]))).toEqual({
      essential: DH(100),
      discretionary: DH(60),
      unclassified: DH(25),
    });
    const drilled = await listTransactions(db, drillFilter(range, null, { essential: 'essential' })!);
    expect(drilled.map((t) => t.amountMinor)).toEqual([DH(100)]);
  });

  it('breaks down by merchant, account and product; business spending is excluded', async () => {
    const bank = await personalAccount(db, 'Bank', 'bank', 1000);
    const company = await businessAccount(db, 'Company', 1000);
    await spend(100, { merchantName: 'BIM', items: [item('Milk', 24), item('Eggs', 30)] });
    await saveExpense(db, { date: today, amountMinor: DH(70), accountId: bank, merchantName: 'BIM' });
    await saveExpense(db, { date: today, amountMinor: DH(500), accountId: company, merchantName: 'BIM' });

    const facts = await loadExpenseFacts(db, range);
    const scoped = applyFilter(facts.facts, null);
    expect(breakdown(scoped, 'merchant', facts.tags).rows).toEqual([
      expect.objectContaining({ label: 'BIM', totalMinor: DH(170), count: 2 }),
    ]);
    expect(breakdown(scoped, 'account', facts.tags).rows.map((r) => r.totalMinor)).toEqual([DH(100), DH(70)]);
    const products = breakdown(scoped, 'product', facts.tags);
    expect(products.rows.map((r) => [r.label, r.totalMinor])).toEqual([
      ['Not itemised by product', DH(116)],
      ['Eggs', DH(30)],
      ['Milk', DH(24)],
    ]);
    expect(products.overlapping).toBe(false);
    expect(products.totalMinor).toBe(DH(170));
  });
});

describe('product price history', () => {
  it('compares compatible units only and never invents quantities', async () => {
    const lastWeek = addDays(today, -7);
    await saveExpense(db, {
      date: lastWeek, amountMinor: DH(124), accountId: wallet, merchantName: 'BIM',
      items: [item('Chicken', 124, { quantityMilli: 2000, unit: 'kg' })],
    });
    await spend(34, { merchantName: 'Marjane', items: [item('Chicken', 34, { quantityMilli: 500_000, unit: 'g' })] });
    await spend(40, { merchantName: 'Marjane', items: [item('Chicken', 40, { quantityMilli: 1000, unit: 'pack' })] });
    await spend(25, { merchantName: 'Butcher', items: [item('Chicken', 25)] });

    const [{ id }] = await db.all<{ id: string }>('SELECT id FROM products');
    const p = (await productDetail(db, id))!;
    expect(p.stats.totalSpentMinor).toBe(DH(223));
    expect(p.stats.purchaseCount).toBe(4);
    expect(p.stats.linesWithoutUnit).toBe(1);
    expect(p.stats.groups.map((g) => g.unitLabel)).toEqual(['kg', 'pack']);

    const kg = p.stats.groups[0];
    expect(kg.quantityMicro).toBe(2_500_000);
    expect(kg.measuredSpentMinor).toBe(DH(158));
    expect(kg.averagePriceMinor).toBe(DH(63.2));
    expect(kg.cheapest).toMatchObject({ priceMinor: DH(62), merchantName: 'BIM' });
    expect(kg.latest).toMatchObject({ priceMinor: DH(68), merchantName: 'Marjane' });
    expect(kg.byMerchant.map((m) => [m.merchantName, m.averagePriceMinor])).toEqual([
      ['BIM', DH(62)],
      ['Marjane', DH(68)],
    ]);
    // The pack is shown on its own, never converted into kilograms.
    expect(p.stats.groups[1]).toMatchObject({ quantityMicro: 1_000_000, averagePriceMinor: DH(40) });
    expect(p.stats.averageDaysBetween).toBe(7);
  });

  it('uses a recorded unit price when no total was entered', () => {
    const stats = productStats([
      {
        itemId: 'i', transactionId: 't', date: today, merchantId: null, merchantName: null,
        quantityMilli: null, unit: 'g', totalMinor: null, unitPriceMinor: 7, group: 'mass', quantityMicro: null,
        normalisedPriceMinor: 7_000,
      },
    ]);
    expect(stats.groups[0].averagePriceMinor).toBeNull();
    expect(stats.groups[0].latest?.priceMinor).toBe(7_000);
  });
});

describe('insights explain their calculation', () => {
  it('reports top categories, changes, daily average and cheapest price with the numbers used', async () => {
    await spend(340, { categoryId: 'sys-cat-snacks' });
    await spend(124, {
      categoryId: 'sys-cat-meat-fish', merchantName: 'BIM',
      items: [item('Chicken', 124, { quantityMilli: 2000, unit: 'kg' })],
    });
    await spend(68, {
      categoryId: 'sys-cat-meat-fish', merchantName: 'Marjane',
      items: [item('Chicken', 68, { quantityMilli: 1000, unit: 'kg' })],
    });
    const cur = await loadExpenseFacts(db, { from: today, to: today });
    const prev = await loadExpenseFacts(db, { from: addDays(today, -1), to: addDays(today, -1) });
    const list = spendingInsights(cur, prev, 1);
    expect(list[0].title).toBe('You spent 340 DH on Snacks this month');
    expect(list[0].calculation).toContain('1 expense');
    expect(list.find((i) => i.id === 'daily-average')?.title).toBe('Your average daily spending is 532 DH');

    const lines = await loadProductLines(db);
    const products = productInsights(lines, lines, { from: today, to: today });
    expect(products.find((i) => i.id.startsWith('qty'))?.title).toBe('You bought 3 kg of Chicken this month for 192 DH');
    const cheapest = products.find((i) => i.id.startsWith('cheapest'));
    expect(cheapest?.title).toBe('Cheapest Chicken: 62 DH/kg at BIM');
    expect(cheapest?.calculation).toContain('Latest: 68 DH/kg');
  });

  it('produces nothing without data', async () => {
    const empty = await loadExpenseFacts(db, range);
    expect(spendingInsights(empty, empty, 30)).toEqual([]);
  });
});
