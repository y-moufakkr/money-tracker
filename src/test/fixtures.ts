import type { Db } from '@/db/types';
import { addDays, todayISO } from '@/domain/dates';
import type { AccountKind } from '@/domain/types';
import { createAccount, listCompanies } from '@/services/accounts';
import { saveBudget } from '@/services/budgets';
import { createTag } from '@/services/catalog';
import { emptyAssumptions, fiscalYearBounds, saveFiscalYear, saveTaxAssumptions } from '@/services/company';
import { approveDistribution, payDistribution } from '@/services/distributions';
import { createGoal, setAllocation } from '@/services/goals';
import { saveExpense, saveIncome, saveTransfer } from '@/services/ledger';
import { payLiability, saveLiability } from '@/services/obligations';

export const DH = (n: number) => Math.round(n * 100);
export const today = todayISO();
export const start = addDays(today, -400);

export function personalAccount(db: Db, name: string, kind: AccountKind, opening: number, currency = 'MAD') {
  return createAccount(db, { name, kind, ownership: 'personal', openingBalanceMinor: DH(opening), openingDate: start, currency });
}

export function businessAccount(db: Db, name: string, opening: number) {
  return createAccount(db, {
    name,
    kind: 'bank',
    ownership: 'business',
    newCompanyName: 'Zenown SARL',
    openingBalanceMinor: DH(opening),
    openingDate: start,
  });
}

export const count = async (db: Db, sql: string, params: (string | number)[] = []) =>
  (await db.first<{ n: number }>(sql, params))?.n ?? 0;

/**
 * A realistic mix of personal and company data across every phase: items and tags, a goal and a
 * budget, company revenue, an obligation paid in part, and an approved distribution paid by a
 * dividend transfer.
 */
export async function populate(db: Db) {

  const bank = await personalAccount(db, 'Personal bank', 'bank', 20000);
  const wallet = await personalAccount(db, 'Wallet', 'cash', 800);
  const companyBank = await businessAccount(db, 'Company bank', 100000);
  const companyId = (await listCompanies(db))[0].id;
  const tag = await createTag(db, { name: 'Gym diet' });
  const groceries = await saveExpense(db, {
    date: today,
    amountMinor: DH(158),
    accountId: wallet,
    categoryId: 'sys-cat-veg-fruit',
    merchantName: 'Moul Lkhodra, "Derb"',
    note: '=2kg chicken',
    tagIds: [tag],
    items: [{ lineKind: 'product', name: 'Chicken', quantityMilli: 2000, unit: 'kg', unitPriceMinor: DH(62), totalMinor: DH(124) }],
  });
  await saveIncome(db, { date: today, amountMinor: DH(200000), accountId: companyBank, categoryId: 'sys-cat-co-revenue' });
  await saveExpense(db, { date: today, amountMinor: DH(50000), accountId: companyBank, categoryId: 'sys-cat-business' });
  const salary = await saveTransfer(db, { date: today, fromAccountId: companyBank, toAccountId: bank, amountMinor: DH(8000), transferClass: 'salary' });
  await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: wallet, amountMinor: DH(500) });
  const goal = await createGoal(db, { name: 'Emergency fund', targetMinor: DH(20000) });
  await setAllocation(db, { goalId: goal, accountId: bank, amountMinor: DH(5000) });
  await saveBudget(db, { name: 'Food', period: 'monthly', amountMinor: DH(2500), lines: [] });
  const fy = fiscalYearBounds(1, today);
  const fyId = await saveFiscalYear(db, { companyId, label: fy.label, startDate: fy.startDate, endDate: fy.endDate });
  await saveTaxAssumptions(db, fyId, {
    ...emptyAssumptions(fyId),
    isRateBp: 2000,
    withholdingRateBp: 1250,
    sourceNote: 'Accountant, 2026 rates',
  });
  const tva = await saveLiability(db, { companyId, kind: 'tva', label: 'TVA Q3', amountMinor: DH(15000), dueDate: today });
  await payLiability(db, { liabilityId: tva, accountId: companyBank, date: today, amountMinor: DH(7000) });
  const distribution = await approveDistribution(db, { companyId, fiscalYearId: fyId, approvedAt: today, totalGrossMinor: DH(40000), ownershipBp: 9500, withholdingBp: 1250 });
  const dividend = await payDistribution(db, { distributionId: distribution, fromAccountId: companyBank, toAccountId: bank, date: today, amountMinor: DH(10000) });
  return { bank, wallet, companyBank, companyId, tag, groceries, salary, goal, fyId, tva, distribution, dividend };
}

/** Every row of every table except device-local backup metadata, for exact comparisons. */
export async function dumpData(db: Db) {
  const tables = await db.all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('sync_meta', 'backups') ORDER BY name`,
  );
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) out[name] = await db.all(`SELECT * FROM ${name} ORDER BY rowid`);
  return out;
}
