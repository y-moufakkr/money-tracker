import type { Db } from '@/db/types';
import { addDays } from '@/domain/dates';
import { formatDecimal } from '@/domain/money';
import { DH, populate, today } from '@/test/fixtures';
import { createTestDb } from '@/test/node-db';
import { moneySummary } from './balances';
import { csvCell, exportEntries, exportJson, toCsv, totalsOf, type ExportFilter } from './export';
import { createCategory } from './catalog';
import { saveExpense, saveIncome } from './ledger';

let db: Db;
let ids: Awaited<ReturnType<typeof populate>>;
const all: ExportFilter = { from: addDays(today, -30), to: today, scope: 'all', categoryIds: null };

beforeEach(async () => {
  db = await createTestDb();
  ids = await populate(db);
});

type JsonExport = {
  personal?: { entries: { amount: string; amount_minor: number; counterpart_side: string | null }[]; totals: { currency: string; income: { amount_minor: number }; expenses: { amount_minor: number }; transfers_in: { amount_minor: number }; net_change: { amount_minor: number }; income_from_company: { amount_minor: number } }[] };
  companies?: {
    name: string;
    entries: unknown[];
    totals: { income: { amount_minor: number }; expenses: { amount_minor: number }; transfers_out: { amount_minor: number }; net_change: { amount_minor: number } }[];
    fiscal_years: { assumptions: { is_rate: { percent: string }; source: string } }[];
    obligations: { label: string; paid: { amount: string }; outstanding: { amount: string } }[];
    distributions: { your_net: { amount: string }; paid_to_you: { amount: string } }[];
  }[];
};

describe('export', () => {
  it('formats amounts from minor units without floats or grouping', () => {
    expect(formatDecimal(12350)).toBe('123.50');
    expect(formatDecimal(-5)).toBe('-0.05');
    expect(formatDecimal(123456789)).toBe('1234567.89');
    expect(formatDecimal(0)).toBe('0.00');
    expect(formatDecimal(1200, 'JPY')).toBe('1200');
  });

  it('writes valid CSV: quoting, formula-safe text, exact amounts', async () => {
    const csv = toCsv(await exportEntries(db, all));
    expect(csv.startsWith('﻿side,company,date,type,account,')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    const groceries = lines.find((l) => l.includes(ids.groceries))!;
    // Merchant with a comma and quotes is quoted; a note starting with "=" cannot run as a formula.
    expect(groceries).toContain('"Moul Lkhodra, ""Derb"""');
    expect(groceries).toContain(`,'=2kg chicken,`);
    expect(groceries).toContain(',-158.00,MAD,');
    expect(groceries.startsWith('personal,,')).toBe(true);
    expect(csvCell('-5')).toBe(`'-5`);
    expect(csvCell('-5', false)).toBe('-5');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('keeps personal and company money on separate rows and sides', async () => {
    const entries = await exportEntries(db, all);
    // The salary transfer is two rows: out of the company, into the personal bank.
    const salary = entries.filter((e) => e.transactionId === ids.salary);
    expect(salary.map((e) => [e.side, e.companyName, e.amountMinor, e.counterpartSide])).toEqual([
      ['personal', null, DH(8000), 'company'],
      ['company', 'Zenown SARL', -DH(8000), 'personal'],
    ]);
    // Personal rows come first, then each company.
    const sides = entries.map((e) => e.side);
    expect(sides.indexOf('company')).toBeGreaterThan(sides.lastIndexOf('personal'));

    const personal = await exportEntries(db, { ...all, scope: 'personal' });
    expect(personal.every((e) => e.side === 'personal' && e.companyName === null)).toBe(true);
    const company = await exportEntries(db, { ...all, scope: 'company' });
    expect(company.every((e) => e.side === 'company' && e.companyName === 'Zenown SARL')).toBe(true);
    expect(personal.length + company.length).toBe(entries.length);
  });

  it('never adds company money to personal totals', async () => {
    const json = (await exportJson(db, all, { appVersion: '1.0.0' })) as JsonExport;
    const p = json.personal!.totals.find((t) => t.currency === 'MAD')!;
    // Personal: 158 expense; transfers in: salary 8,000 + dividend 10,000 + 500 wallet top-up.
    expect(p.expenses.amount_minor).toBe(DH(158));
    expect(p.income.amount_minor).toBe(0);
    expect(p.income_from_company.amount_minor).toBe(DH(18000));
    expect(p.transfers_in.amount_minor).toBe(DH(18500));
    // The personal net change matches the real change of personal money (opening 20,800).
    expect(p.net_change.amount_minor).toBe((await moneySummary(db)).personal.liquid - DH(20800));

    const co = json.companies![0];
    expect(co.name).toBe('Zenown SARL');
    const c = co.totals[0];
    expect(c.income.amount_minor).toBe(DH(200000));
    expect(c.expenses.amount_minor).toBe(DH(50000 + 7000));
    expect(c.transfers_out.amount_minor).toBe(DH(18000));
    expect(c.net_change.amount_minor).toBe(DH(200000 - 57000 - 18000));
    // No grand total across sides exists anywhere in the export.
    expect(Object.keys(json)).not.toContain('totals');

    expect(co.fiscal_years[0].assumptions).toMatchObject({ is_rate: { percent: '20.00' }, source: 'Accountant, 2026 rates' });
    expect(co.obligations.find((o) => o.label === 'TVA Q3')).toMatchObject({ paid: { amount: '7000.00' }, outstanding: { amount: '8000.00' } });
    expect(co.distributions[0]).toMatchObject({ your_net: { amount: '33250.00' }, paid_to_you: { amount: '10000.00' } });

    const personalOnly = (await exportJson(db, { ...all, scope: 'personal' }, { appVersion: '1.0.0' })) as JsonExport;
    expect(personalOnly.companies).toBeUndefined();
    expect(personalOnly.personal!.totals).toEqual(json.personal!.totals);
    const companyOnly = (await exportJson(db, { ...all, scope: 'company' }, { appVersion: '1.0.0' })) as JsonExport;
    expect(companyOnly.personal).toBeUndefined();
  });

  it('respects the date range and the selected categories (with subcategories)', async () => {
    await saveExpense(db, { date: addDays(today, -60), amountMinor: DH(40), accountId: ids.wallet, categoryId: 'sys-cat-coffee' });
    await saveExpense(db, { date: today, amountMinor: DH(25), accountId: ids.wallet, categoryId: 'sys-cat-coffee' });
    await saveExpense(db, { date: today, amountMinor: DH(10), accountId: ids.wallet });
    await saveIncome(db, { date: today, amountMinor: DH(300), accountId: ids.bank, categoryId: 'sys-cat-salary' });

    const coffee = await exportEntries(db, { ...all, categoryIds: ['sys-cat-coffee'] });
    expect(coffee.map((e) => e.amountMinor)).toEqual([-DH(25)]);
    const older = await exportEntries(db, { ...all, from: addDays(today, -90), categoryIds: ['sys-cat-coffee'] });
    expect(older.map((e) => e.amountMinor)).toEqual([-DH(40), -DH(25)]);

    // Selecting a parent category includes its subcategories.
    const specialty = await createCategory(db, { name: 'Specialty coffee', kind: 'expense', parentId: 'sys-cat-coffee' });
    await saveExpense(db, { date: today, amountMinor: DH(45), accountId: ids.wallet, categoryId: specialty });
    expect((await exportEntries(db, { ...all, categoryIds: ['sys-cat-coffee'] })).map((e) => [e.category, e.parentCategory, e.amountMinor])).toEqual([
      ['Coffee', null, -DH(25)],
      ['Specialty coffee', 'Coffee', -DH(45)],
    ]);
    expect((await exportEntries(db, { ...all, categoryIds: [specialty] })).map((e) => e.amountMinor)).toEqual([-DH(45)]);
    // A category selection leaves out transfers; uncategorised entries only when asked.
    const withNone = await exportEntries(db, { ...all, categoryIds: ['sys-cat-coffee'], includeUncategorised: true });
    expect(withNone.map((e) => e.amountMinor).sort()).toEqual([-DH(25), -DH(45), -DH(10)].sort());
    expect(withNone.some((e) => e.kind === 'transfer')).toBe(false);
    expect(await exportEntries(db, { ...all, categoryIds: [] })).toEqual([]);
    expect(totalsOf(coffee)).toEqual([expect.objectContaining({ currency: 'MAD', expensesMinor: DH(25), netChangeMinor: -DH(25) })]);
  });
});
