import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';

import { expoDb } from '@/db/expo';
import type { Db } from '@/db/types';
import type { DateRange } from '@/domain/dates';
import type { Account, CategoryKind, Ownership } from '@/domain/types';
import { getAccount, getCompany, listAccounts, listCompanies, listInstruments } from '@/services/accounts';
import { listMerchants, listProducts, loadExpenseFacts, merchantDetail, productDetail } from '@/services/analytics';
import { accountBalance, accountBalances, accountLedger, accountReservations, balanceHistory, moneySummary } from '@/services/balances';
import { budgetStatuses, getBudget } from '@/services/budgets';
import { listAllCategories, listTags } from '@/services/catalog';
import { getGoal, listGoals } from '@/services/goals';
import { insights } from '@/services/insights';
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
import { fiscalYearReport, listFiscalYears, listReserves } from '@/services/company';
import { companyAnalytics } from '@/services/company-analytics';
import { getDistribution, listDistributions, listSimulations, unmatchedDividendTransfers } from '@/services/distributions';
import { getLiability, listLiabilities, paymentCandidates, transactionLinks } from '@/services/obligations';
import { companyDashboard, threeTotals } from '@/services/overview';

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

export function useAllCategories(kind: CategoryKind) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'all-categories', kind], queryFn: () => listAllCategories(db, kind) });
}

export function useTags(includeArchived = false) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'tags', includeArchived], queryFn: () => listTags(db, { includeArchived }) });
}

export function useExpenseFacts(range: DateRange) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'facts', range.from, range.to], queryFn: () => loadExpenseFacts(db, range) });
}

export function useBudgetStatuses() {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'budget-statuses'], queryFn: () => budgetStatuses(db) });
}

export function useBudget(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'budget', id], queryFn: () => getBudget(db, id!), enabled: !!id });
}

export function useGoals() {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'goals'], queryFn: () => listGoals(db) });
}

export function useGoal(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'goal', id], queryFn: () => getGoal(db, id!), enabled: !!id });
}

export function useAccountReservations() {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'reservations'], queryFn: () => accountReservations(db) });
}

export function useInsights() {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'insights'], queryFn: () => insights(db) });
}

export function useBalanceHistory(dates: string[]) {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'balance-history', dates],
    queryFn: () => balanceHistory(db, dates),
    placeholderData: (prev) => prev,
  });
}

export function useProducts(search: string) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'product-list', search], queryFn: () => listProducts(db, search), placeholderData: (prev) => prev });
}

export function useProduct(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'product', id], queryFn: () => productDetail(db, id!), enabled: !!id });
}

export function useMerchants(search: string) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'merchant-list', search], queryFn: () => listMerchants(db, search), placeholderData: (prev) => prev });
}

export function useMerchant(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'merchant', id], queryFn: () => merchantDetail(db, id!), enabled: !!id });
}

// ---------------------------------------------------------------------------
// Company money (Phase 3)

export function useCompany(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'company', id], queryFn: () => getCompany(db, id!), enabled: !!id });
}

export function useCompanyDashboard(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'company-dashboard', id], queryFn: () => companyDashboard(db, id!), enabled: !!id });
}

export function useThreeTotals() {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'three-totals'], queryFn: () => threeTotals(db) });
}

export function useFiscalYears(companyId: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'fiscal-years', companyId], queryFn: () => listFiscalYears(db, companyId!), enabled: !!companyId });
}

export function useFiscalYearReport(fiscalYearId: string | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'fiscal-year-report', fiscalYearId],
    queryFn: () => fiscalYearReport(db, fiscalYearId!),
    enabled: !!fiscalYearId,
  });
}

export function useLiabilities(companyId: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'liabilities', companyId], queryFn: () => listLiabilities(db, { companyId }), enabled: !!companyId });
}

export function useLiability(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'liability', id], queryFn: () => getLiability(db, id!), enabled: !!id });
}

export function usePaymentCandidates(liabilityId: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'payment-candidates', liabilityId], queryFn: () => paymentCandidates(db, liabilityId!), enabled: !!liabilityId });
}

export function useReserves(companyId: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'reserves', companyId], queryFn: () => listReserves(db, companyId!), enabled: !!companyId });
}

export function useSimulations(companyId: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'simulations', companyId], queryFn: () => listSimulations(db, companyId!), enabled: !!companyId });
}

export function useDistributions(companyId: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'distributions', companyId], queryFn: () => listDistributions(db, { companyId }), enabled: !!companyId });
}

export function useDistribution(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'distribution', id], queryFn: () => getDistribution(db, id!), enabled: !!id });
}

export function useDividendCandidates(companyId: string | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'dividend-candidates', companyId],
    queryFn: () => unmatchedDividendTransfers(db, companyId!),
    enabled: !!companyId,
  });
}

export function useCompanyAnalytics(companyId: string | undefined, range: DateRange) {
  const db = useDb();
  return useQuery({
    queryKey: [LEDGER, 'company-analytics', companyId, range.from, range.to],
    queryFn: () => companyAnalytics(db, companyId!, range),
    enabled: !!companyId,
    placeholderData: (prev) => prev,
  });
}

export function useTransactionLinks(transactionId: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: [LEDGER, 'transaction-links', transactionId], queryFn: () => transactionLinks(db, transactionId!), enabled: !!transactionId });
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
