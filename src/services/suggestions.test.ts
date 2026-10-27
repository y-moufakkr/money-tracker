import { COMPANY_CATEGORIES } from '@/db/seed';
import type { Db } from '@/db/types';
import { addDays } from '@/domain/dates';
import { categoriesFor } from '@/components/entry-pickers';
import { createTestDb } from '@/test/node-db';
import { DH, personalAccount, today } from '@/test/fixtures';
import { saveExpense, saveIncome } from './ledger';
import { listCategories, suggestMerchants } from './queries';

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

describe('entry suggestions from history', () => {
  it('lists recent places before anything is typed, with where and how much was paid last time', async () => {
    const wallet = await personalAccount(db, 'Wallet', 'cash', 1000);
    const bank = await personalAccount(db, 'Bank', 'bank', 1000);
    await saveExpense(db, { date: addDays(today, -5), amountMinor: DH(40), accountId: wallet, merchantName: 'Café Paris', categoryId: 'sys-cat-coffee' });
    await saveExpense(db, { date: addDays(today, -1), amountMinor: DH(35), accountId: bank, merchantName: 'Café Paris', categoryId: 'sys-cat-coffee' });
    await saveExpense(db, { date: addDays(today, -3), amountMinor: DH(420), accountId: bank, merchantName: 'Marjane' });
    await saveIncome(db, { date: today, amountMinor: DH(900), accountId: wallet, merchantName: 'Client' });

    const recent = await suggestMerchants(db);
    expect(recent.map((m) => m.name)).toEqual(['Client', 'Café Paris', 'Marjane']);
    const cafe = recent.find((m) => m.name === 'Café Paris')!;
    expect(cafe).toMatchObject({ defaultCategoryId: 'sys-cat-coffee', useCount: 2, last: { accountId: bank, amountMinor: DH(35), currency: 'MAD' } });
    // The client was only ever a payer: no expense to repeat.
    expect(recent.find((m) => m.name === 'Client')!.last).toBeNull();
    expect((await suggestMerchants(db, '', 8, 'income')).find((m) => m.name === 'Client')!.last).toMatchObject({ accountId: wallet, amountMinor: DH(900) });

    // While typing: substring matches, names starting with the text first.
    expect((await suggestMerchants(db, 'ar')).map((m) => m.name)).toEqual(['Café Paris', 'Marjane']);
    expect((await suggestMerchants(db, 'mar')).map((m) => m.name)).toEqual(['Marjane']);
  });

  it('company categories appear only for company locations, first', async () => {
    const all = await listCategories(db, 'expense');
    const companyIds = new Set(COMPANY_CATEGORIES.map((c) => c.id));
    expect(all.some((c) => companyIds.has(c.id))).toBe(true);
    expect(categoriesFor(all, 'personal').some((c) => companyIds.has(c.id))).toBe(false);
    const business = categoriesFor(all, 'business');
    expect(business).toHaveLength(all.length);
    expect(companyIds.has(business[0].id)).toBe(true);
  });
});
