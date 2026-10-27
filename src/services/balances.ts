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

// ---------------------------------------------------------------------------
// Goal reservations. An allocation reserves part of a real account: it never
// moves money and never adds to a total. What an account can back is capped
// by its current balance.

export type AllocationRow = { goalId: string; accountId: string; amountMinor: number };

export type AccountReservation = {
  accountId: string;
  balanceMinor: number;
  /** Σ allocations on this account (account currency). */
  allocatedMinor: number;
  /** Part of the allocations covered by the balance: min(allocated, max(balance, 0)). */
  backedMinor: number;
  /** Balance left after backed allocations (never negative unless the balance is). */
  unallocatedMinor: number;
  /** Allocations not covered by the balance. */
  overAllocatedMinor: number;
  /** Backed amount per goal; sums to `backedMinor`. */
  byGoal: Map<string, number>;
};

/**
 * Pure. Caps each account's allocations at its balance. When an account holds
 * less than is allocated, the money it does hold is split between its goals
 * pro rata (largest remainder), so the backed amounts add up exactly.
 */
export function reserveAllocations(
  balances: { id: string; balanceMinor: number }[],
  allocations: AllocationRow[],
): Map<string, AccountReservation> {
  const out = new Map<string, AccountReservation>();
  for (const b of balances) {
    const own = allocations.filter((a) => a.accountId === b.id);
    const allocated = own.reduce((sum, a) => sum + a.amountMinor, 0);
    const holdable = Math.max(0, b.balanceMinor);
    const backed = Math.min(allocated, holdable);
    const byGoal = new Map<string, number>();
    if (allocated <= holdable) {
      for (const a of own) byGoal.set(a.goalId, (byGoal.get(a.goalId) ?? 0) + a.amountMinor);
    } else {
      const shares = own.map((a) => {
        const num = BigInt(a.amountMinor) * BigInt(holdable);
        const q = num / BigInt(allocated);
        return { goalId: a.goalId, base: Number(q), rem: num - q * BigInt(allocated) };
      });
      let left = holdable - shares.reduce((sum, x) => sum + x.base, 0);
      for (const x of [...shares].sort((p, q) => (q.rem > p.rem ? 1 : q.rem < p.rem ? -1 : 0))) {
        if (left <= 0) break;
        x.base += 1;
        left -= 1;
      }
      for (const x of shares) byGoal.set(x.goalId, (byGoal.get(x.goalId) ?? 0) + x.base);
    }
    out.set(b.id, {
      accountId: b.id,
      balanceMinor: b.balanceMinor,
      allocatedMinor: allocated,
      backedMinor: backed,
      unallocatedMinor: b.balanceMinor - backed,
      overAllocatedMinor: allocated - backed,
      byGoal,
    });
  }
  return out;
}

export async function listAllocations(db: Db): Promise<AllocationRow[]> {
  const rows = await db.all<{ goal_id: string; account_id: string; amount_minor: number }>(
    'SELECT goal_id, account_id, amount_minor FROM goal_allocations ORDER BY created_at',
  );
  return rows.map((r) => ({ goalId: r.goal_id, accountId: r.account_id, amountMinor: r.amount_minor }));
}

/** Current reservations on every active account. */
export async function accountReservations(db: Db): Promise<Map<string, AccountReservation>> {
  const [balances, allocations] = await Promise.all([accountBalances(db), listAllocations(db)]);
  return reserveAllocations(balances, allocations);
}

export type PersonalSummary = {
  bank: number;
  cash: number;
  savings: number;
  otherLiquid: number;
  liquid: number;
  /** Money reserved for savings goals (backed by real balances). Bills come in Phase 5. */
  reserved: number;
  /** Liquid − reserved: money not set aside for anything. */
  available: number;
  /** Reservations only exist in the present; historical views report 0. */
  reservationsApply: boolean;
  /** Accounts holding less than is allocated to goals on them. */
  overAllocated: { account: ConvertedAccount; allocatedMinor: number; shortMinor: number }[];
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

/**
 * Personal and company totals at the end of `asOf`. Past dates include
 * locations archived since then, because they held money at the time.
 */
export async function moneySummary(db: Db, asOf: string = todayISO()): Promise<MoneySummary> {
  const current = asOf >= todayISO();
  const [balances, rates, companies, allocations] = await Promise.all([
    accountBalances(db, { asOf, includeArchived: !current }),
    latestRates(db, asOf),
    listCompanies(db),
    current ? listAllocations(db) : Promise.resolve([]),
  ]);
  const reservations = reserveAllocations(balances, allocations);
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
    reservationsApply: current,
    overAllocated: [],
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
      const r = reservations.get(a.id);
      if (r && r.allocatedMinor > 0) {
        personal.reserved += convertToBase(r.backedMinor, a.currency, rates) ?? 0;
        if (r.overAllocatedMinor > 0) {
          personal.overAllocated.push({ account: a, allocatedMinor: r.allocatedMinor, shortMinor: r.overAllocatedMinor });
        }
      }
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

export type BalancePoint = {
  date: string;
  /** Personal liquid assets (base currency). */
  liquid: number;
  /** Liquid − credit card debt. */
  netLiquid: number;
  /** Balance per location at that date, in its own currency. */
  accounts: Record<string, number>;
};

/** Balances at the end of each date, built from the same calculation as My Money. */
export async function balanceHistory(db: Db, dates: string[]): Promise<BalancePoint[]> {
  const points: BalancePoint[] = [];
  for (const date of dates) {
    const s = await moneySummary(db, date);
    const accounts: Record<string, number> = {};
    for (const a of s.personal.accounts) accounts[a.id] = a.balanceMinor;
    for (const co of s.companies) for (const a of co.accounts) accounts[a.id] = a.balanceMinor;
    points.push({ date, liquid: s.personal.liquid, netLiquid: s.personal.netLiquid, accounts });
  }
  return points;
}
