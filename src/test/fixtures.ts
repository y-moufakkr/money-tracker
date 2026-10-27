import type { Db } from '@/db/types';
import { addDays, todayISO } from '@/domain/dates';
import type { AccountKind } from '@/domain/types';
import { createAccount } from '@/services/accounts';

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
