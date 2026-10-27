import { LedgerError, type Db } from '@/db/types';
import { isValidISODate } from '@/domain/dates';
import { BASE_CURRENCY } from '@/domain/money';
import type {
  Account,
  AccountKind,
  Company,
  InstrumentKind,
  Ownership,
  PaymentInstrument,
} from '@/domain/types';
import { newId, nowISO } from '@/lib/id';

type AccountRow = {
  id: string;
  name: string;
  kind: AccountKind;
  ownership: Ownership;
  company_id: string | null;
  currency: string;
  opening_balance_minor: number;
  opening_date: string;
  institution: string | null;
  notes: string | null;
  color: string | null;
  sort_order: number;
  is_archived: number;
};

export function mapAccount(r: AccountRow): Account {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    ownership: r.ownership,
    companyId: r.company_id,
    currency: r.currency,
    openingBalanceMinor: r.opening_balance_minor,
    openingDate: r.opening_date,
    institution: r.institution,
    notes: r.notes,
    color: r.color,
    sortOrder: r.sort_order,
    isArchived: r.is_archived === 1,
  };
}

export async function listAccounts(db: Db, opts: { includeArchived?: boolean } = {}): Promise<Account[]> {
  const rows = await db.all<AccountRow>(
    `SELECT * FROM accounts ${opts.includeArchived ? '' : 'WHERE is_archived = 0'}
     ORDER BY ownership DESC, sort_order, created_at`,
  );
  return rows.map(mapAccount);
}

export async function getAccount(db: Db, id: string): Promise<Account | null> {
  const r = await db.first<AccountRow>('SELECT * FROM accounts WHERE id = ?', [id]);
  return r ? mapAccount(r) : null;
}

export async function requireAccount(db: Db, id: string): Promise<Account> {
  const a = await getAccount(db, id);
  if (!a) throw new LedgerError('Money location not found.');
  return a;
}

export type AccountInput = {
  name: string;
  kind: AccountKind;
  ownership: Ownership;
  companyId?: string | null;
  /** Creates a company on the fly when a business account has no company yet. */
  newCompanyName?: string | null;
  currency?: string;
  /** Signed. Credit cards: negative means money owed. */
  openingBalanceMinor: number;
  openingDate: string;
  institution?: string | null;
  notes?: string | null;
  color?: string | null;
};

function clean(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

async function resolveCompany(tx: Db, input: AccountInput): Promise<string | null> {
  if (input.ownership === 'personal') return null;
  if (input.companyId) {
    const c = await tx.first('SELECT id FROM companies WHERE id = ?', [input.companyId]);
    if (!c) throw new LedgerError('Company not found.');
    return input.companyId;
  }
  const name = clean(input.newCompanyName);
  if (!name) throw new LedgerError('Business money must belong to a company. Enter the company name.');
  return createCompany(tx, { name });
}

function validateAccount(input: AccountInput) {
  if (!clean(input.name)) throw new LedgerError('Give this money location a name.');
  if (!isValidISODate(input.openingDate)) throw new LedgerError('Opening balance date is invalid.');
  if (!Number.isSafeInteger(input.openingBalanceMinor)) throw new LedgerError('Opening balance is invalid.');
  if (input.kind === 'credit_card' && input.openingBalanceMinor > 0) {
    throw new LedgerError('A credit card balance is money owed. Enter it as an amount owed, not a positive balance.');
  }
}

export async function createAccount(db: Db, input: AccountInput): Promise<string> {
  validateAccount(input);
  return db.transaction(async (tx) => {
    const companyId = await resolveCompany(tx, input);
    const id = newId();
    const ts = nowISO();
    const order = await tx.first<{ n: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM accounts');
    await tx.run(
      `INSERT INTO accounts (id, name, kind, ownership, company_id, currency, opening_balance_minor, opening_date,
         institution, notes, color, sort_order, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        id,
        input.name.trim(),
        input.kind,
        input.ownership,
        companyId,
        input.currency ?? BASE_CURRENCY,
        input.openingBalanceMinor,
        input.openingDate,
        clean(input.institution),
        clean(input.notes),
        input.color ?? null,
        order?.n ?? 0,
        ts,
        ts,
      ],
    );
    return id;
  });
}

export async function updateAccount(db: Db, id: string, input: AccountInput): Promise<void> {
  validateAccount(input);
  await db.transaction(async (tx) => {
    const existing = await requireAccount(tx, id);
    const currency = input.currency ?? existing.currency;

    const usage = await tx.first<{ n: number; earliest: string | null; transfers: number }>(
      `SELECT COUNT(*) AS n, MIN(t.date) AS earliest,
              SUM(CASE WHEN t.kind = 'transfer' THEN 1 ELSE 0 END) AS transfers
       FROM postings p JOIN transactions t ON t.id = p.transaction_id
       WHERE p.account_id = ? AND t.deleted_at IS NULL`,
      [id],
    );
    const used = (usage?.n ?? 0) > 0;
    if (used && currency !== existing.currency) {
      throw new LedgerError('The currency cannot change once transactions are recorded in this location.');
    }
    if (usage?.earliest && input.openingDate > usage.earliest) {
      throw new LedgerError(
        `The opening date cannot be after the first recorded transaction (${usage.earliest}).`,
      );
    }
    if ((usage?.transfers ?? 0) > 0 && input.ownership !== existing.ownership) {
      throw new LedgerError(
        'Ownership cannot change after transfers were recorded — it would reclassify those transfers. Create a new location instead.',
      );
    }
    const companyId = await resolveCompany(tx, input);
    if ((usage?.transfers ?? 0) > 0 && companyId !== existing.companyId) {
      throw new LedgerError('The company cannot change after transfers were recorded.');
    }
    await tx.run(
      `UPDATE accounts SET name = ?, kind = ?, ownership = ?, company_id = ?, currency = ?, opening_balance_minor = ?,
         opening_date = ?, institution = ?, notes = ?, color = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name.trim(),
        input.kind,
        input.ownership,
        companyId,
        currency,
        input.openingBalanceMinor,
        input.openingDate,
        clean(input.institution),
        clean(input.notes),
        input.color ?? existing.color,
        nowISO(),
        id,
      ],
    );
  });
}

/**
 * Archiving hides a location. Only an empty location may be archived,
 * otherwise its money would silently disappear from the totals.
 */
export async function setAccountArchived(db: Db, id: string, archived: boolean, balanceMinor: number): Promise<void> {
  if (archived && balanceMinor !== 0) {
    throw new LedgerError('Move or spend the remaining balance before archiving — archived locations are not counted.');
  }
  await db.transaction(async (tx) => {
    await tx.run('UPDATE accounts SET is_archived = ?, updated_at = ? WHERE id = ?', [archived ? 1 : 0, nowISO(), id]);
    // An empty, archived location cannot back a goal: release its reservations.
    if (archived) await tx.run('DELETE FROM goal_allocations WHERE account_id = ?', [id]);
  });
}

/** Hard delete is only allowed for locations that were never used. */
export async function deleteAccount(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const used = await tx.first<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM postings WHERE account_id = ?)
            + (SELECT COUNT(*) FROM reconciliations WHERE account_id = ?) AS n`,
      [id, id],
    );
    if ((used?.n ?? 0) > 0) {
      throw new LedgerError('This location has history. Archive it instead of deleting it.');
    }
    await tx.run('DELETE FROM payment_instruments WHERE account_id = ?', [id]);
    await tx.run('DELETE FROM goal_allocations WHERE account_id = ?', [id]);
    await tx.run('DELETE FROM accounts WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Companies

type CompanyRow = { id: string; name: string; legal_form: string; ownership_bp: number; currency: string };

const mapCompany = (r: CompanyRow): Company => ({
  id: r.id,
  name: r.name,
  legalForm: r.legal_form,
  ownershipBp: r.ownership_bp,
  currency: r.currency,
});

export async function listCompanies(db: Db): Promise<Company[]> {
  const rows = await db.all<CompanyRow>('SELECT * FROM companies ORDER BY created_at');
  return rows.map(mapCompany);
}

export async function createCompany(
  db: Db,
  input: { name: string; legalForm?: string; ownershipBp?: number },
): Promise<string> {
  const name = clean(input.name);
  if (!name) throw new LedgerError('Company name is required.');
  const bp = input.ownershipBp ?? 10000;
  if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new LedgerError('Ownership must be between 0% and 100%.');
  const id = newId();
  const ts = nowISO();
  await db.run(
    `INSERT INTO companies (id, name, legal_form, ownership_bp, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, input.legalForm ?? 'SARL', bp, BASE_CURRENCY, ts, ts],
  );
  return id;
}

export async function updateCompany(db: Db, id: string, input: { name: string; ownershipBp: number }): Promise<void> {
  const name = clean(input.name);
  if (!name) throw new LedgerError('Company name is required.');
  if (!Number.isInteger(input.ownershipBp) || input.ownershipBp < 0 || input.ownershipBp > 10000) {
    throw new LedgerError('Ownership must be between 0% and 100%.');
  }
  await db.run('UPDATE companies SET name = ?, ownership_bp = ?, updated_at = ? WHERE id = ?', [
    name,
    input.ownershipBp,
    nowISO(),
    id,
  ]);
}

// ---------------------------------------------------------------------------
// Payment instruments (cards). They never hold money; each one points at an account.

type InstrumentRow = {
  id: string;
  name: string;
  kind: InstrumentKind;
  account_id: string;
  last4: string | null;
  is_archived: number;
};

const mapInstrument = (r: InstrumentRow): PaymentInstrument => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  accountId: r.account_id,
  last4: r.last4,
  isArchived: r.is_archived === 1,
});

export async function listInstruments(db: Db, opts: { includeArchived?: boolean } = {}): Promise<PaymentInstrument[]> {
  const rows = await db.all<InstrumentRow>(
    `SELECT pi.* FROM payment_instruments pi JOIN accounts a ON a.id = pi.account_id
     ${opts.includeArchived ? '' : 'WHERE pi.is_archived = 0 AND a.is_archived = 0'}
     ORDER BY pi.created_at`,
  );
  return rows.map(mapInstrument);
}

const INSTRUMENT_ACCOUNT_KINDS: Record<InstrumentKind, AccountKind[]> = {
  debit: ['bank', 'savings', 'ewallet'],
  credit: ['credit_card'],
  prepaid: ['prepaid'],
};

export async function createInstrument(
  db: Db,
  input: { name: string; kind: InstrumentKind; accountId: string; last4?: string | null },
): Promise<string> {
  const name = clean(input.name);
  if (!name) throw new LedgerError('Card name is required.');
  const last4 = clean(input.last4);
  if (last4 && !/^\d{4}$/.test(last4)) throw new LedgerError('Last 4 digits must be exactly 4 numbers.');
  const account = await requireAccount(db, input.accountId);
  if (!INSTRUMENT_ACCOUNT_KINDS[input.kind].includes(account.kind)) {
    const hint =
      input.kind === 'debit'
        ? 'A debit card must be linked to a bank, savings or mobile wallet account.'
        : input.kind === 'credit'
          ? 'A credit card must point at a credit card location (which tracks what you owe).'
          : 'A prepaid card must point at a prepaid card location (which holds its own balance).';
    throw new LedgerError(hint);
  }
  const id = newId();
  const ts = nowISO();
  await db.run(
    `INSERT INTO payment_instruments (id, name, kind, account_id, last4, is_archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, name, input.kind, input.accountId, last4, ts, ts],
  );
  return id;
}

export async function setInstrumentArchived(db: Db, id: string, archived: boolean): Promise<void> {
  await db.run('UPDATE payment_instruments SET is_archived = ?, updated_at = ? WHERE id = ?', [
    archived ? 1 : 0,
    nowISO(),
    id,
  ]);
}
