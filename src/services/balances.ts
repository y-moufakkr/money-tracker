/**
 * The single place where balances are computed. Nothing in the app stores a
 * balance; every figure is opening balance + postings of live transactions.
 */
import type { Db } from '@/db/types';
import { todayISO } from '@/domain/dates';
import { BASE_CURRENCY, convertToBase } from '@/domain/money';
import type { Account, AccountWithBalance, Company } from '@/domain/types';
import { listCompanies, mapAccount } from './accounts';
import { latestRates } from './fx';

const BALANCE_SQL = `
  SELECT a.*,
    (CASE WHEN a.opening_date <= $asOf THEN a.opening_balance_minor ELSE 0 END)
    + COALESCE((
        SELECT SUM(p.amount_minor) FROM postings p
        JOIN transactions t ON t.id = p.transaction_id
        WHERE p.account_id = a.id AND t.deleted_at IS NULL AND t.date <= $asOf
      ), 0) AS balance_minor
  FROM accounts a`;

type BalanceRow = Parameters<typeof mapAccount>[0] & { balance_minor: number };

const withBalance = (r: BalanceRow): AccountWithBalance => ({ ...mapAccount(r), balanceMinor: r.balance_minor });

/** Balances at the end of `asOf`. Locations opened after `asOf` are omitted. */
export async function accountBalances(
  db: Db,
  opts: { asOf?: string; includeArchived?: boolean } = {},
): Promise<AccountWithBalance[]> {
  const asOf = opts.asOf ?? todayISO();
  const rows = await db.all<BalanceRow>(
    `${BALANCE_SQL} WHERE a.opening_date <= $asOf ${opts.includeArchived ? '' : 'AND a.is_archived = 0'}
     ORDER BY a.ownership DESC, a.sort_order, a.created_at`,
    { $asOf: asOf },
  );
  return rows.map(withBalance);
}

export async function accountBalance(db: Db, accountId: string, asOf: string = todayISO()): Promise<number> {
  const row = await db.first<BalanceRow>(`${BALANCE_SQL} WHERE a.id = $id`, { $asOf: asOf, $id: accountId });
  return row?.balance_minor ?? 0;
}

export type ConvertedAccount = AccountWithBalance & { baseMinor: number | null };

export type PersonalSummary = {
  bank: number;
  cash: number;
  savings: number;
  otherLiquid: number;
  liquid: number;
  /** Goal and bill reservations — Phase 2. */
  reserved: number;
  available: number;
  liabilities: number;
  netLiquid: number;
  accounts: ConvertedAccount[];
  /** Foreign-currency locations with no exchange rate: shown, but not in totals. */
  unconverted: ConvertedAccount[];
};

export type CompanySummary = {
  company: Company;
  bank: number;
  cash: number;
  other: number;
  total: number;
  liabilities: number;
  accounts: ConvertedAccount[];
  unconverted: ConvertedAccount[];
};

export type MoneySummary = {
  asOf: string;
  currency: string;
  personal: PersonalSummary;
  companies: CompanySummary[];
};

export async function moneySummary(db: Db, asOf: string = todayISO()): Promise<MoneySummary> {
  const [balances, rates, companies] = await Promise.all([
    accountBalances(db, { asOf }),
    latestRates(db, asOf),
    listCompanies(db),
  ]);
  const converted: ConvertedAccount[] = balances.map((a) => ({
    ...a,
    baseMinor: convertToBase(a.balanceMinor, a.currency, rates),
  }));

  const personal: PersonalSummary = {
    bank: 0,
    cash: 0,
    savings: 0,
    otherLiquid: 0,
    liquid: 0,
    reserved: 0,
    available: 0,
    liabilities: 0,
    netLiquid: 0,
    accounts: [],
    unconverted: [],
  };

  const companyMap = new Map<string, CompanySummary>(
    companies.map((c) => [
      c.id,
      { company: c, bank: 0, cash: 0, other: 0, total: 0, liabilities: 0, accounts: [], unconverted: [] },
    ]),
  );

  for (const a of converted) {
    if (a.ownership === 'personal') {
      personal.accounts.push(a);
      if (a.baseMinor === null) {
        personal.unconverted.push(a);
        continue;
      }
      const v = a.baseMinor;
      switch (a.kind) {
        case 'bank':
          personal.bank += v;
          break;
        case 'cash':
          personal.cash += v;
          break;
        case 'savings':
          personal.savings += v;
          break;
        case 'credit_card':
          if (v < 0) personal.liabilities += -v;
          else personal.otherLiquid += v;
          break;
        default:
          personal.otherLiquid += v;
      }
    } else if (a.companyId) {
      const c = companyMap.get(a.companyId);
      if (!c) continue;
      c.accounts.push(a);
      if (a.baseMinor === null) {
        c.unconverted.push(a);
        continue;
      }
      const v = a.baseMinor;
      if (a.kind === 'credit_card' && v < 0) c.liabilities += -v;
      else if (a.kind === 'bank' || a.kind === 'savings') c.bank += v;
      else if (a.kind === 'cash') c.cash += v;
      else c.other += v;
    }
  }

  personal.liquid = personal.bank + personal.cash + personal.savings + personal.otherLiquid;
  personal.available = personal.liquid - personal.reserved;
  personal.netLiquid = personal.liquid - personal.liabilities;
  for (const c of companyMap.values()) c.total = c.bank + c.cash + c.other;

  return {
    asOf,
    currency: BASE_CURRENCY,
    personal,
    companies: [...companyMap.values()].filter((c) => c.accounts.length > 0),
  };
}

export type AccountLedgerLine = {
  transactionId: string;
  date: string;
  kind: string;
  amountMinor: number;
  balanceAfterMinor: number;
};

/** Every posting on an account with the running balance after it, newest first. */
export async function accountLedger(db: Db, account: Account): Promise<AccountLedgerLine[]> {
  const rows = await db.all<{ transaction_id: string; date: string; kind: string; amount_minor: number }>(
    `SELECT p.transaction_id, t.date, t.kind, p.amount_minor
     FROM postings p JOIN transactions t ON t.id = p.transaction_id
     WHERE p.account_id = ? AND t.deleted_at IS NULL
     ORDER BY t.date, t.created_at, p.created_at`,
    [account.id],
  );
  let running = account.openingBalanceMinor;
  const lines = rows.map((r) => {
    running += r.amount_minor;
    return {
      transactionId: r.transaction_id,
      date: r.date,
      kind: r.kind,
      amountMinor: r.amount_minor,
      balanceAfterMinor: running,
    };
  });
  return lines.reverse();
}
