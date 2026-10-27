import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';

import { expoDb } from '@/db/expo';
import type { Db } from '@/db/types';
import type { DateRange } from '@/domain/dates';
import type { Account, CategoryKind, Ownership } from '@/domain/types';
import { getAccount, listAccounts, listCompanies, listInstruments } from '@/services/accounts';
import { accountBalance, accountBalances, accountLedger, moneySummary } from '@/services/balances';
import { listRates } from '@/services/fx';
import {
  getSetting,
  getTransaction,
  listCategories,
  listTransactions,
  periodSummary,
  suggestMerchants,
  suggestProducts,
  type TransactionFilter,
} from '@/services/queries';
import { listReconciliations } from '@/services/reconciliation';

const wrapped = new WeakMap<SQLiteDatabase, Db>();

/** One Db wrapper (and therefore one write queue) per SQLite connection. */
export function dbFor(sqlite: SQLiteDatabase): Db {
  let db = wrapped.get(sqlite);
  if (!db) {
    db = expoDb(sqlite);
    wrapped.set(sqlite, db);
  }
  return db;
}

export function useDb(): Db {
  return dbFor(useSQLiteContext());
}

/** Every query key starts with 'ledger' so one invalidation refreshes all derived data. */
const LEDGER = 'ledger';

export function useMoneySummary(asOf?: string) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'summary', asOf ?? 'today'], queryFn: () => moneySummary(db, asOf) });
}

export function useAccounts(includeArchived = false) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'accounts', includeArchived], queryFn: () => listAccounts(db, { includeArchived }) });
}

export function useAccountBalances(opts: { includeArchived?: boolean; asOf?: string } = {}) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'balances', opts], queryFn: () => accountBalances(db, opts) });
}

export function useAccount(id: string | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'account', id],
    queryFn: async () => {
      const account = await getAccount(db, id!);
      if (!account) return null;
      return { ...account, balanceMinor: await accountBalance(db, account.id) };
    },
    enabled: !!id,
  });
}

export function useAccountLedger(account: Account | null | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'account-ledger', account?.id, account?.openingBalanceMinor],
    queryFn: () => accountLedger(db, account!),
    enabled: !!account,
  });
}

export function useInstruments() {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'instruments'], queryFn: () => listInstruments(db) });
}

export function useCompanies() {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'companies'], queryFn: () => listCompanies(db) });
}

export function useTransactions(filter: TransactionFilter) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'transactions', filter], queryFn: () => listTransactions(db, filter) });
}

export function useTransaction(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'transaction', id], queryFn: () => getTransaction(db, id!), enabled: !!id });
}

export function usePeriodSummary(range: DateRange, ownership: Ownership = 'personal') {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'period', range.from, range.to, ownership],
    queryFn: () => periodSummary(db, range, ownership),
  });
}

export function useCategories(kind: CategoryKind) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'categories', kind], queryFn: () => listCategories(db, kind) });
}

export function useMerchantSuggestions(query: string) {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'merchants', query],
    queryFn: () => suggestMerchants(db, query),
    placeholderData: (prev) => prev,
  });
}

export function useProductSuggestions(query: string, enabled: boolean) {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'products', query],
    queryFn: () => suggestProducts(db, query),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useReconciliations(accountId: string | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'reconciliations', accountId],
    queryFn: () => listReconciliations(db, accountId!),
    enabled: !!accountId,
  });
}

export function useRates() {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'rates'], queryFn: () => listRates(db) });
}

export function useSetting(key: string) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'setting', key], queryFn: () => getSetting(db, key) });
}

/** Runs a write against the DB and refreshes every ledger-derived query on success. */
export function useLedgerMutation<TInput, TResult>(fn: (db: Db, input: TInput) => Promise<TResult>) {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => fn(db, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [LEDGER] }),
  });
}
