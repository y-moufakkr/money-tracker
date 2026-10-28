import { migrate } from '@/db/migrations';
import type { Db } from '@/db/types';
import { addDays } from '@/domain/dates';
import { estimateItems, findReference } from '@/domain/price-estimate';
import type { PurchaseItemInput } from '@/domain/types';
import { count, DH, dumpData, personalAccount, populate, today } from '@/test/fixtures';
import { createTestDb } from '@/test/node-db';
import { productDetail } from './analytics';
import { saveExpense } from './ledger';
import { deleteMyPrice, learnedPrices, listMyPrices, loadPriceRefs, priceBook, saveMyPrice } from './prices';
import { getTransaction, suggestProducts } from './queries';

let db: Db;
let wallet: string;

beforeEach(async () => {
  db = await createTestDb();
  wallet = await personalAccount(db, 'Wallet', 'cash', 5000);
});

const line = (name: string, extra: Partial<PurchaseItemInput> = {}): PurchaseItemInput => ({
  lineKind: 'product',
  name,
  quantityMilli: null,
  unit: null,
  unitPriceMinor: null,
  totalMinor: null,
  ...extra,
});

const buy = (amount: number, items: PurchaseItemInput[], date = today) =>
  saveExpense(db, { date, amountMinor: DH(amount), accountId: wallet, items });

describe('learned prices', () => {
  it('averages the last three purchases in the latest unit group', async () => {
    await buy(10, [line('Tomates', { quantityMilli: 1000, unit: 'kg', totalMinor: DH(10) })], addDays(today, -40));
    await buy(6, [line('Tomates', { quantityMilli: 1000, unit: 'kg', totalMinor: DH(6) })], addDays(today, -20));
    await buy(4, [line('Tomates', { quantityMilli: 500_000, unit: 'g', totalMinor: DH(4) })], addDays(today, -10));
    await buy(9, [line('Tomates', { quantityMilli: 1000, unit: 'kg', totalMinor: DH(9) })], today);
    const [t] = await learnedPrices(db);
    // (9 + 4 + 6) ÷ 2.5 kg; the oldest purchase is left out.
    expect(t).toMatchObject({ name: 'Tomates', unit: 'kg', priceMinor: 760, typicalMilli: 1000, source: 'history', date: today });
  });

  it('uses the usual amount per purchase when no quantity was recorded', async () => {
    await buy(30, [line('Légumes', { totalMinor: DH(30) })], addDays(today, -3));
    await buy(40, [line('Légumes', { totalMinor: DH(40) })]);
    expect(await learnedPrices(db)).toMatchObject([{ name: 'Légumes', unit: null, priceMinor: DH(35) }]);
  });

  it('never learns from estimated lines or deleted expenses', async () => {
    await buy(20, [line('Tomates', { quantityMilli: 1000, unit: 'kg', totalMinor: DH(20), estimated: true })]);
    expect(await learnedPrices(db)).toEqual([]);
  });
});

describe('your price list', () => {
  it('keeps one price per name and validates it', async () => {
    const id = await saveMyPrice(db, { name: 'Tomatoes', unit: 'kg', priceMinor: DH(9) });
    expect(await saveMyPrice(db, { name: 'tomatoes', unit: 'kg', priceMinor: DH(7) })).toBe(id);
    expect(await listMyPrices(db)).toMatchObject([{ name: 'tomatoes', unit: 'kg', priceMinor: DH(7) }]);
    await expect(saveMyPrice(db, { name: ' ', unit: 'kg', priceMinor: 100 })).rejects.toThrow(/Name/);
    await expect(saveMyPrice(db, { name: 'X', unit: 'kg', priceMinor: 0 })).rejects.toThrow(/above zero/);
    await deleteMyPrice(db, id);
    expect(await listMyPrices(db)).toEqual([]);
  });

  it('is tracked for backups', async () => {
    const before = (await db.first<{ change_seq: number }>('SELECT change_seq FROM sync_meta WHERE id = 1'))!.change_seq;
    await saveMyPrice(db, { name: 'Tomatoes', unit: 'kg', priceMinor: DH(9) });
    expect((await db.first<{ change_seq: number }>('SELECT change_seq FROM sync_meta WHERE id = 1'))!.change_seq).toBeGreaterThan(before);
  });
});

describe('price book', () => {
  it('joins your price and your purchases to the starter item they name', async () => {
    await saveMyPrice(db, { name: 'Tomatoes', unit: 'kg', priceMinor: DH(9) });
    await buy(12, [line('Tomates', { quantityMilli: 2000, unit: 'kg', totalMinor: DH(12) })]);
    await buy(25, [line('Croquettes chat', { quantityMilli: 1000, unit: 'kg', totalMinor: DH(25) })]);
    const rows = await priceBook(db);
    const tomatoes = rows.find((r) => r.name === 'Tomatoes')!;
    expect(tomatoes.starter?.priceMinor).toBe(800);
    expect(tomatoes.mine?.priceMinor).toBe(DH(9));
    expect(tomatoes.history?.priceMinor).toBe(DH(6));
    // Same day: your purchase comes first.
    expect(tomatoes.active.source).toBe('history');
    expect(rows.find((r) => r.name === 'Croquettes chat')).toMatchObject({ group: 'yours', active: { priceMinor: DH(25) } });
    expect(rows.find((r) => r.name === 'Onions')?.active.source).toBe('starter');
  });

  it('lets your price answer to the starter names', async () => {
    await saveMyPrice(db, { name: 'Tomatoes', unit: 'kg', priceMinor: DH(9) });
    const refs = await loadPriceRefs(db);
    expect(findReference('matecha', refs)).toMatchObject({ source: 'mine', priceMinor: DH(9) });
  });
});

describe('estimated lines in the ledger', () => {
  it('stores estimates that split the amount paid, and never uses them as prices', async () => {
    await buy(8, [line('Tomates', { quantityMilli: 1000, unit: 'kg', totalMinor: DH(8), unitPriceMinor: DH(8) })], addDays(today, -5));
    const lines = [line('Tomates', { quantityMilli: 2000, unit: 'kg' }), line('Poulet'), line('Pain', { totalMinor: DH(6) })];
    const r = estimateItems(DH(60), lines.map((l) => ({ ...l, estimated: false })), await loadPriceRefs(db));
    if (!r.ok) throw new Error(r.reason);
    const items = lines.map((l, i) => {
      const e = r.lines.find((x) => x.index === i);
      return e ? { ...l, totalMinor: e.totalMinor, estimated: true } : l;
    });
    const id = await buy(60, items);

    const t = (await getTransaction(db, id))!;
    expect(t.items.map((i) => [i.name, i.totalMinor, i.estimated])).toEqual([
      // 54 DH left after the bread, split 16 : 33 (2 kg at 8 DH, 1.5 kg at 22 DH), in whole dirhams.
      ['Tomates', DH(18), true],
      ['Poulet', DH(36), true],
      ['Pain', DH(6), false],
    ]);
    expect(t.items.reduce((s, i) => s + (i.totalMinor ?? 0), 0)).toBe(t.amountMinor);

    // Price history and suggestions only know the real 8 DH/kg; the estimate counts as spending.
    const tomates = (await suggestProducts(db, 'Tomates'))[0];
    expect(tomates.lastUnitPriceMinor).toBe(DH(8));
    const detail = (await productDetail(db, t.items[0].productId!))!;
    expect(detail.stats.totalSpentMinor).toBe(DH(26));
    expect(detail.stats.groups[0].averagePriceMinor).toBe(DH(8));
    expect((await learnedPrices(db)).find((p) => p.name === 'Tomates')?.priceMinor).toBe(DH(8));
  });

  it('refuses estimates that do not add up to the amount paid', async () => {
    await expect(buy(50, [line('Tomates', { totalMinor: DH(40), estimated: true })])).rejects.toThrow(/no longer add up/);
    await expect(buy(50, [{ ...line('Other'), lineKind: 'unallocated', totalMinor: DH(50), estimated: true }])).rejects.toThrow(
      /only an item/,
    );
    await expect(buy(50, [line('Tomates', { estimated: true })])).rejects.toThrow(/only an item/);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
    // Lines without estimates keep the old rule: a breakdown that may not add up.
    await buy(50, [line('Tomates', { totalMinor: DH(40) })]);
  });
});

describe('migration v7', () => {
  it('on a v6 database with data, only adds an unset estimated flag and an empty price list', async () => {
    const old = await createTestDb(6);
    await populate(old);
    const before = await dumpData(old);
    expect(await migrate(old)).toBe(7);
    const after = await dumpData(old);
    expect(before.purchase_items.length).toBeGreaterThan(0);
    expect(after).toEqual({
      ...before,
      purchase_items: before.purchase_items.map((r) => ({ ...(r as object), estimated: 0 })),
      price_refs: [],
    });
  });
});
