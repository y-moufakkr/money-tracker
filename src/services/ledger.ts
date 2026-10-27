/**
 * All writes that move money go through this module. Each public function runs
 * in a single SQLite transaction, so a transfer or an edit is all-or-nothing.
 */
import { SYSTEM_CATEGORY } from '@/db/seed';
import { LedgerError, type Db } from '@/db/types';
import { formatDateLabel, isValidISODate, todayISO } from '@/domain/dates';
import type { Account, CategoryKind, PurchaseItemInput, TransactionKind, TransferClass } from '@/domain/types';
import { newId, nowISO } from '@/lib/id';
import { requireAccount } from './accounts';

export type ExpenseInput = {
  date: string;
  amountMinor: number;
  /** Either an account or a card; a card resolves to the account it draws from. */
  accountId?: string | null;
  instrumentId?: string | null;
  categoryId?: string | null;
  merchantName?: string | null;
  note?: string | null;
  items?: PurchaseItemInput[];
};

export type IncomeInput = {
  date: string;
  amountMinor: number;
  accountId: string;
  categoryId?: string | null;
  /** Payer / source, stored as a merchant. */
  merchantName?: string | null;
  note?: string | null;
};

export type TransferInput = {
  date: string;
  fromAccountId: string;
  toAccountId: string;
  /** Amount leaving the source, in the source currency. */
  amountMinor: number;
  /** Amount arriving, in the destination currency. Required when currencies differ. */
  receivedMinor?: number | null;
  /** Fee charged on the source account; recorded as a linked expense. */
  feeMinor?: number | null;
  transferClass?: TransferClass | null;
  note?: string | null;
};

// ---------------------------------------------------------------------------
// Validation helpers

function assertAmount(v: number | null | undefined, label = 'Amount'): asserts v is number {
  if (v === null || v === undefined || !Number.isSafeInteger(v) || v <= 0) {
    throw new LedgerError(`${label} must be greater than zero.`);
  }
}

function assertDate(date: string) {
  if (!isValidISODate(date)) throw new LedgerError('Date is invalid.');
  if (date > todayISO()) {
    throw new LedgerError('Future dates are not allowed: only money that actually moved affects balances.');
  }
}

function assertUsable(account: Account, date: string) {
  if (account.isArchived) throw new LedgerError(`"${account.name}" is archived.`);
  if (date < account.openingDate) {
    throw new LedgerError(
      `"${account.name}" starts on ${formatDateLabel(account.openingDate)}. Record earlier activity in its opening balance, or move the opening date back.`,
    );
  }
}

async function assertCategory(tx: Db, categoryId: string | null | undefined, kind: CategoryKind) {
  if (!categoryId) return;
  const c = await tx.first<{ kind: string }>('SELECT kind FROM categories WHERE id = ?', [categoryId]);
  if (!c) throw new LedgerError('Category not found.');
  if (c.kind !== kind) throw new LedgerError(`Choose an ${kind} category.`);
}

function clean(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/** Finds or creates a merchant by case-insensitive name and learns its default category. */
async function upsertMerchant(tx: Db, name: string | null | undefined, categoryId: string | null | undefined) {
  const n = clean(name);
  if (!n) return null;
  const existing = await tx.first<{ id: string }>('SELECT id FROM merchants WHERE name = ? COLLATE NOCASE', [n]);
  const ts = nowISO();
  if (existing) {
    if (categoryId) {
      await tx.run('UPDATE merchants SET default_category_id = ?, updated_at = ? WHERE id = ?', [
        categoryId,
        ts,
        existing.id,
      ]);
    }
    return existing.id;
  }
  const id = newId();
  await tx.run(
    'INSERT INTO merchants (id, name, default_category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, n, categoryId ?? null, ts, ts],
  );
  return id;
}

async function upsertProduct(tx: Db, name: string, unit: string | null) {
  const existing = await tx.first<{ id: string }>('SELECT id FROM products WHERE name = ? COLLATE NOCASE', [name]);
  if (existing) return existing.id;
  const id = newId();
  const ts = nowISO();
  await tx.run('INSERT INTO products (id, name, default_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    name,
    unit,
    ts,
    ts,
  ]);
  return id;
}

function validateItems(items: PurchaseItemInput[]) {
  for (const [i, it] of items.entries()) {
    const label = `Item ${i + 1}`;
    if (!clean(it.name)) throw new LedgerError(`${label} needs a name.`);
    for (const [v, what] of [
      [it.quantityMilli, 'quantity'],
      [it.unitPriceMinor, 'unit price'],
      [it.totalMinor, 'total'],
    ] as const) {
      if (v !== null && (!Number.isSafeInteger(v) || v < 0)) throw new LedgerError(`${label}: ${what} is invalid.`);
    }
    if (it.lineKind !== 'product' && it.totalMinor === null) {
      throw new LedgerError(`${label}: a ${it.lineKind} line needs an amount.`);
    }
  }
}

async function insertItems(tx: Db, transactionId: string, items: PurchaseItemInput[]) {
  const ts = nowISO();
  for (const [i, it] of items.entries()) {
    const name = it.name.trim();
    const productId = it.lineKind === 'product' ? await upsertProduct(tx, name, it.unit) : null;
    await tx.run(
      `INSERT INTO purchase_items (id, transaction_id, product_id, line_kind, name, quantity_milli, unit,
         unit_price_minor, total_minor, notes, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        transactionId,
        productId,
        it.lineKind,
        name,
        it.quantityMilli,
        clean(it.unit),
        it.unitPriceMinor,
        it.totalMinor,
        clean(it.notes),
        i,
        ts,
      ],
    );
  }
}

async function insertPosting(tx: Db, transactionId: string, accountId: string, amount: number, role: string) {
  await tx.run(
    'INSERT INTO postings (id, transaction_id, account_id, amount_minor, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [newId(), transactionId, accountId, amount, role, nowISO()],
  );
}

type Header = {
  kind: TransactionKind;
  date: string;
  amountMinor: number;
  currency: string;
  categoryId?: string | null;
  merchantId?: string | null;
  instrumentId?: string | null;
  transferClass?: TransferClass | null;
  parentId?: string | null;
  note?: string | null;
};

/** Inserts a header, or — when `id` exists — updates it and clears its derived rows. */
async function writeHeader(tx: Db, id: string | null, h: Header): Promise<string> {
  const ts = nowISO();
  const values = [
    h.kind,
    h.date,
    h.amountMinor,
    h.currency,
    h.categoryId ?? null,
    h.merchantId ?? null,
    h.instrumentId ?? null,
    h.transferClass ?? null,
    h.parentId ?? null,
    clean(h.note),
  ];
  if (!id) {
    const newTxId = newId();
    await tx.run(
      `INSERT INTO transactions (kind, date, amount_minor, currency, category_id, merchant_id, instrument_id,
         transfer_class, parent_id, note, id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...values, newTxId, ts, ts],
    );
    return newTxId;
  }
  await tx.run(
    `UPDATE transactions SET kind = ?, date = ?, amount_minor = ?, currency = ?, category_id = ?, merchant_id = ?,
       instrument_id = ?, transfer_class = ?, parent_id = ?, note = ?, updated_at = ?
     WHERE id = ?`,
    [...values, ts, id],
  );
  await clearDerived(tx, id);
  return id;
}

/** Removes postings, items and linked fee transactions so an edit can rewrite them. */
async function clearDerived(tx: Db, id: string) {
  const children = await tx.all<{ id: string }>('SELECT id FROM transactions WHERE parent_id = ?', [id]);
  for (const c of children) {
    await tx.run('DELETE FROM postings WHERE transaction_id = ?', [c.id]);
    await tx.run('DELETE FROM transactions WHERE id = ?', [c.id]);
  }
  await tx.run('DELETE FROM postings WHERE transaction_id = ?', [id]);
  await tx.run('DELETE FROM purchase_items WHERE transaction_id = ?', [id]);
}

async function requireEditable(tx: Db, id: string, kind: TransactionKind) {
  const row = await tx.first<{ kind: string; deleted_at: string | null; parent_id: string | null }>(
    'SELECT kind, deleted_at, parent_id FROM transactions WHERE id = ?',
    [id],
  );
  if (!row || row.deleted_at) throw new LedgerError('Transaction not found.');
  if (row.kind !== kind) throw new LedgerError(`This is not an ${kind} transaction.`);
  if (row.parent_id) throw new LedgerError('This fee belongs to a transfer. Edit the transfer instead.');
}

// ---------------------------------------------------------------------------
// Expense

export async function saveExpense(db: Db, input: ExpenseInput, id: string | null = null): Promise<string> {
  assertAmount(input.amountMinor);
  assertDate(input.date);
  const items = input.items ?? [];
  validateItems(items);

  return db.transaction(async (tx) => {
    if (id) await requireEditable(tx, id, 'expense');

    let accountId = input.accountId ?? null;
    let instrumentId: string | null = null;
    if (input.instrumentId) {
      const inst = await tx.first<{ account_id: string }>(
        'SELECT account_id FROM payment_instruments WHERE id = ?',
        [input.instrumentId],
      );
      if (!inst) throw new LedgerError('Card not found.');
      if (accountId && accountId !== inst.account_id) {
        throw new LedgerError('The selected card is linked to a different money location.');
      }
      accountId = inst.account_id;
      instrumentId = input.instrumentId;
    }
    if (!accountId) throw new LedgerError('Choose where the money came from.');
    const account = await requireAccount(tx, accountId);
    assertUsable(account, input.date);
    await assertCategory(tx, input.categoryId, 'expense');

    const merchantId = await upsertMerchant(tx, input.merchantName, input.categoryId);
    const txId = await writeHeader(tx, id, {
      kind: 'expense',
      date: input.date,
      amountMinor: input.amountMinor,
      currency: account.currency,
      categoryId: input.categoryId,
      merchantId,
      instrumentId,
      note: input.note,
    });
    await insertPosting(tx, txId, account.id, -input.amountMinor, 'main');
    await insertItems(tx, txId, items);
    return txId;
  });
}

// ---------------------------------------------------------------------------
// Income

export async function saveIncome(db: Db, input: IncomeInput, id: string | null = null): Promise<string> {
  assertAmount(input.amountMinor);
  assertDate(input.date);

  return db.transaction(async (tx) => {
    if (id) await requireEditable(tx, id, 'income');
    const account = await requireAccount(tx, input.accountId);
    assertUsable(account, input.date);
    if (account.kind === 'credit_card') {
      throw new LedgerError('Income cannot be received on a credit card. Record a refund as income on the account that received it.');
    }
    await assertCategory(tx, input.categoryId, 'income');
    const merchantId = await upsertMerchant(tx, input.merchantName, input.categoryId);
    const txId = await writeHeader(tx, id, {
      kind: 'income',
      date: input.date,
      amountMinor: input.amountMinor,
      currency: account.currency,
      categoryId: input.categoryId,
      merchantId,
      note: input.note,
    });
    await insertPosting(tx, txId, account.id, input.amountMinor, 'main');
    return txId;
  });
}

// ---------------------------------------------------------------------------
// Transfer

/** Accounts belong to different owners (personal vs business, or two different companies). */
export function isCrossOwnership(from: Account, to: Account): boolean {
  return from.ownership !== to.ownership || (from.companyId ?? null) !== (to.companyId ?? null);
}

export async function saveTransfer(db: Db, input: TransferInput, id: string | null = null): Promise<string> {
  assertAmount(input.amountMinor);
  assertDate(input.date);
  if (input.fromAccountId === input.toAccountId) throw new LedgerError('Choose two different money locations.');
  if (input.feeMinor !== null && input.feeMinor !== undefined && input.feeMinor !== 0) {
    assertAmount(input.feeMinor, 'Fee');
  }

  return db.transaction(async (tx) => {
    if (id) await requireEditable(tx, id, 'transfer');
    const from = await requireAccount(tx, input.fromAccountId);
    const to = await requireAccount(tx, input.toAccountId);
    assertUsable(from, input.date);
    assertUsable(to, input.date);

    let received = input.amountMinor;
    if (from.currency !== to.currency) {
      assertAmount(input.receivedMinor, `Amount received in ${to.currency}`);
      received = input.receivedMinor;
    } else if (input.receivedMinor !== null && input.receivedMinor !== undefined && input.receivedMinor !== input.amountMinor) {
      throw new LedgerError('Both locations use the same currency, so the amount received must equal the amount sent. Record any fee separately.');
    }

    let transferClass: TransferClass = 'internal';
    if (isCrossOwnership(from, to)) {
      if (!input.transferClass || input.transferClass === 'internal') {
        throw new LedgerError(
          'Money moving between the company and you must be classified (salary, dividend, reimbursement, loan…).',
        );
      }
      if (input.transferClass === 'other' && !clean(input.note)) {
        throw new LedgerError('Explain an "Other" company transfer in the note.');
      }
      transferClass = input.transferClass;
    }

    const txId = await writeHeader(tx, id, {
      kind: 'transfer',
      date: input.date,
      amountMinor: input.amountMinor,
      currency: from.currency,
      transferClass,
      note: input.note,
    });
    await insertPosting(tx, txId, from.id, -input.amountMinor, 'from');
    await insertPosting(tx, txId, to.id, received, 'to');

    if (input.feeMinor) {
      const feeId = await writeHeader(tx, null, {
        kind: 'expense',
        date: input.date,
        amountMinor: input.feeMinor,
        currency: from.currency,
        categoryId: SYSTEM_CATEGORY.bankFees,
        parentId: txId,
        note: `Transfer fee: ${from.name} → ${to.name}`,
      });
      await insertPosting(tx, feeId, from.id, -input.feeMinor, 'main');
    }
    return txId;
  });
}

// ---------------------------------------------------------------------------
// Delete

/**
 * Soft-deletes a transaction (and its linked fee). Balances recalculate
 * automatically. Deleting a reconciliation adjustment re-opens that reconciliation.
 */
export async function deleteTransaction(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await tx.first<{ deleted_at: string | null }>('SELECT deleted_at FROM transactions WHERE id = ?', [id]);
    if (!row || row.deleted_at) throw new LedgerError('Transaction not found.');
    const ts = nowISO();
    await tx.run('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? OR parent_id = ?', [ts, ts, id, id]);
    await tx.run(
      `UPDATE reconciliations SET status = 'open', adjustment_transaction_id = NULL, resolved_at = NULL,
         note = TRIM(COALESCE(note, '') || ' (adjustment deleted ' || ? || ')')
       WHERE adjustment_transaction_id = ?`,
      [ts.slice(0, 10), id],
    );
  });
}
