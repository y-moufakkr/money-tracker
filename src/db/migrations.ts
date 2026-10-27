import { DEFAULT_CATEGORIES } from './seed';
import type { Db } from './types';

type Migration = { version: number; name: string; up: (tx: Db) => Promise<void> };

const now = () => new Date().toISOString();

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core ledger',
    up: async (tx) => {
      await tx.exec(`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );

        CREATE TABLE companies (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          legal_form TEXT NOT NULL DEFAULT 'SARL',
          ownership_bp INTEGER NOT NULL DEFAULT 10000 CHECK (ownership_bp BETWEEN 0 AND 10000),
          ice TEXT,
          fiscal_year_start_month INTEGER NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
          currency TEXT NOT NULL DEFAULT 'MAD',
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE accounts (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bank','cash','savings','prepaid','ewallet','credit_card','other')),
          ownership TEXT NOT NULL CHECK (ownership IN ('personal','business')),
          company_id TEXT REFERENCES companies(id),
          currency TEXT NOT NULL DEFAULT 'MAD',
          opening_balance_minor INTEGER NOT NULL DEFAULT 0,
          opening_date TEXT NOT NULL,
          institution TEXT,
          notes TEXT,
          color TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (ownership = 'personal' OR company_id IS NOT NULL)
        );

        CREATE TABLE payment_instruments (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('debit','credit','prepaid')),
          account_id TEXT NOT NULL REFERENCES accounts(id),
          last4 TEXT,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE categories (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
          parent_id TEXT REFERENCES categories(id),
          icon TEXT,
          color TEXT,
          essential INTEGER,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_system INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE merchants (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          default_category_id TEXT REFERENCES categories(id),
          address TEXT,
          notes TEXT,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE products (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          default_unit TEXT,
          category_id TEXT REFERENCES categories(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE transactions (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('expense','income','transfer','adjustment')),
          date TEXT NOT NULL,
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          currency TEXT NOT NULL,
          category_id TEXT REFERENCES categories(id),
          merchant_id TEXT REFERENCES merchants(id),
          instrument_id TEXT REFERENCES payment_instruments(id),
          transfer_class TEXT CHECK (transfer_class IS NULL OR transfer_class IN
            ('internal','salary','dividend','expense_reimbursement','owner_loan','loan_repayment','capital_contribution','other')),
          parent_id TEXT REFERENCES transactions(id),
          note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE TABLE postings (
          id TEXT PRIMARY KEY NOT NULL,
          transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id),
          amount_minor INTEGER NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('main','from','to')),
          created_at TEXT NOT NULL
        );

        CREATE TABLE purchase_items (
          id TEXT PRIMARY KEY NOT NULL,
          transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          product_id TEXT REFERENCES products(id),
          line_kind TEXT NOT NULL DEFAULT 'product' CHECK (line_kind IN ('product','discount','charge','unallocated')),
          name TEXT NOT NULL,
          quantity_milli INTEGER CHECK (quantity_milli IS NULL OR quantity_milli > 0),
          unit TEXT,
          unit_price_minor INTEGER CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
          total_minor INTEGER CHECK (total_minor IS NULL OR total_minor >= 0),
          category_id TEXT REFERENCES categories(id),
          notes TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE reconciliations (
          id TEXT PRIMARY KEY NOT NULL,
          account_id TEXT NOT NULL REFERENCES accounts(id),
          date TEXT NOT NULL,
          statement_balance_minor INTEGER NOT NULL,
          calculated_balance_minor INTEGER NOT NULL,
          difference_minor INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('matched','open','adjusted')),
          adjustment_transaction_id TEXT REFERENCES transactions(id),
          note TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );

        CREATE TABLE fx_rates (
          id TEXT PRIMARY KEY NOT NULL,
          currency TEXT NOT NULL,
          rate_micros INTEGER NOT NULL CHECK (rate_micros > 0),
          as_of TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX idx_postings_account ON postings(account_id);
        CREATE INDEX idx_postings_tx ON postings(transaction_id);
        CREATE INDEX idx_tx_date ON transactions(date);
        CREATE INDEX idx_tx_kind_date ON transactions(kind, date);
        CREATE INDEX idx_tx_category ON transactions(category_id);
        CREATE INDEX idx_tx_merchant ON transactions(merchant_id);
        CREATE INDEX idx_tx_parent ON transactions(parent_id);
        CREATE INDEX idx_items_tx ON purchase_items(transaction_id);
        CREATE INDEX idx_items_product ON purchase_items(product_id);
        CREATE INDEX idx_recon_account ON reconciliations(account_id, date);
        CREATE INDEX idx_fx_currency ON fx_rates(currency, as_of);
        CREATE INDEX idx_instruments_account ON payment_instruments(account_id);
      `);

      const ts = now();
      for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
        await tx.run(
          `INSERT INTO categories (id, name, kind, parent_id, icon, color, essential, sort_order, is_system, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c.id, c.name, c.kind, c.parentId ?? null, c.icon, c.color, c.essential ?? null, i, c.system ? 1 : 0, ts, ts],
        );
      }
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Applies pending migrations, each in its own transaction. Refuses databases from a newer app. */
export async function migrate(db: Db): Promise<number> {
  await db.exec('PRAGMA foreign_keys = ON');
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${current} is newer than this app (v${SCHEMA_VERSION}). Update the app before opening this data.`,
    );
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.transaction(async (tx) => {
      await m.up(tx);
      await tx.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return SCHEMA_VERSION;
}
