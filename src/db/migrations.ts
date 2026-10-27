import { COMPANY_CATEGORIES, DEBT_CATEGORIES, DEFAULT_CATEGORIES } from './seed';
import type { Db } from './types';

type Migration = {
  version: number;
  name: string;
  up: (tx: Db) => Promise<void>;
  /**
   * Rebuilds a table that other tables reference. Foreign keys are switched off around the
   * migration's transaction (SQLite ignores the pragma inside one), so dropping the old table does
   * not cascade to its children; `foreign_key_check` must be clean before the transaction commits.
   */
  rebuildsTables?: boolean;
};

const now = () => new Date().toISOString();

/**
 * Tables that hold device-local metadata or UI preferences. Every other table is user data and
 * must carry change triggers (see `changeTriggersSql`); a test checks this for every migration.
 */
export const UNTRACKED_TABLES = ['settings', 'sync_meta', 'backups'];

/**
 * Bumps `sync_meta.change_seq` on any write to `table`, so the app knows whether the data changed
 * since the last backup. Any migration that creates a user-data table must run this for it.
 */
export function changeTriggersSql(table: string): string {
  const bump = `UPDATE sync_meta SET change_seq = change_seq + 1, last_change_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1;`;
  return ['INSERT', 'UPDATE', 'DELETE']
    .map((op) => `CREATE TRIGGER trg_change_${table}_${op.toLowerCase()} AFTER ${op} ON ${table} BEGIN ${bump} END;`)
    .join('\n');
}

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
  {
    version: 2,
    name: 'tags, budgets, savings goals',
    up: async (tx) => {
      await tx.exec(`
        CREATE TABLE tags (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          color TEXT,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE transaction_tags (
          transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (transaction_id, tag_id)
        );

        CREATE TABLE item_tags (
          item_id TEXT NOT NULL REFERENCES purchase_items(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (item_id, tag_id)
        );

        CREATE TABLE budgets (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          period TEXT NOT NULL CHECK (period IN ('weekly','monthly','custom')),
          start_date TEXT,
          end_date TEXT,
          amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor > 0),
          currency TEXT NOT NULL DEFAULT 'MAD',
          thresholds TEXT NOT NULL DEFAULT '75,90,100',
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (period <> 'custom' OR (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date <= end_date))
        );

        CREATE TABLE budget_lines (
          id TEXT PRIMARY KEY NOT NULL,
          budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
          category_id TEXT NOT NULL REFERENCES categories(id),
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (budget_id, category_id)
        );

        CREATE TABLE savings_goals (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          target_minor INTEGER NOT NULL CHECK (target_minor > 0),
          currency TEXT NOT NULL DEFAULT 'MAD',
          target_date TEXT,
          monthly_plan_minor INTEGER CHECK (monthly_plan_minor IS NULL OR monthly_plan_minor > 0),
          icon TEXT,
          color TEXT,
          notes TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE goal_allocations (
          id TEXT PRIMARY KEY NOT NULL,
          goal_id TEXT NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id),
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (goal_id, account_id)
        );

        CREATE INDEX idx_tx_tags_tag ON transaction_tags(tag_id);
        CREATE INDEX idx_item_tags_tag ON item_tags(tag_id);
        CREATE INDEX idx_categories_parent ON categories(parent_id);
        CREATE INDEX idx_budget_lines_budget ON budget_lines(budget_id);
        CREATE INDEX idx_allocations_account ON goal_allocations(account_id);
      `);
    },
  },
  {
    version: 3,
    name: 'company money: fiscal years, obligations, reserves, tax assumptions, distributions',
    up: async (tx) => {
      await tx.exec(`
        ALTER TABLE companies ADD COLUMN tva_mode TEXT NOT NULL DEFAULT 'ttc' CHECK (tva_mode IN ('ttc','ht'));

        CREATE TABLE company_fiscal_years (
          id TEXT PRIMARY KEY NOT NULL,
          company_id TEXT NOT NULL REFERENCES companies(id),
          label TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          is_closed INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (start_date <= end_date),
          UNIQUE (company_id, start_date)
        );

        CREATE TABLE tax_assumptions (
          id TEXT PRIMARY KEY NOT NULL,
          fiscal_year_id TEXT NOT NULL UNIQUE REFERENCES company_fiscal_years(id) ON DELETE CASCADE,
          is_rate_bp INTEGER CHECK (is_rate_bp IS NULL OR is_rate_bp BETWEEN 0 AND 10000),
          is_minimum_minor INTEGER CHECK (is_minimum_minor IS NULL OR is_minimum_minor >= 0),
          is_override_minor INTEGER CHECK (is_override_minor IS NULL OR is_override_minor >= 0),
          is_paid_outside_minor INTEGER NOT NULL DEFAULT 0 CHECK (is_paid_outside_minor >= 0),
          withholding_rate_bp INTEGER CHECK (withholding_rate_bp IS NULL OR withholding_rate_bp BETWEEN 0 AND 10000),
          legal_reserve_rate_bp INTEGER CHECK (legal_reserve_rate_bp IS NULL OR legal_reserve_rate_bp BETWEEN 0 AND 10000),
          tva_collected_minor INTEGER CHECK (tva_collected_minor IS NULL OR tva_collected_minor >= 0),
          tva_deductible_minor INTEGER CHECK (tva_deductible_minor IS NULL OR tva_deductible_minor >= 0),
          pre_tracking_revenue_minor INTEGER CHECK (pre_tracking_revenue_minor IS NULL OR pre_tracking_revenue_minor >= 0),
          pre_tracking_expenses_minor INTEGER CHECK (pre_tracking_expenses_minor IS NULL OR pre_tracking_expenses_minor >= 0),
          retained_earnings_minor INTEGER NOT NULL DEFAULT 0,
          source_note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE tax_items (
          id TEXT PRIMARY KEY NOT NULL,
          fiscal_year_id TEXT NOT NULL REFERENCES company_fiscal_years(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('adjustment','other_tax')),
          label TEXT NOT NULL,
          amount_minor INTEGER,
          rate_bp INTEGER CHECK (rate_bp IS NULL OR rate_bp BETWEEN 0 AND 10000),
          base TEXT CHECK (base IS NULL OR base IN ('revenue','taxable_profit')),
          source_note TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (kind = 'adjustment' AND amount_minor IS NOT NULL AND rate_bp IS NULL AND base IS NULL)
            OR (kind = 'other_tax' AND amount_minor IS NOT NULL AND amount_minor >= 0 AND rate_bp IS NULL AND base IS NULL)
            OR (kind = 'other_tax' AND amount_minor IS NULL AND rate_bp IS NOT NULL AND base IS NOT NULL)
          )
        );

        CREATE TABLE company_reserves (
          id TEXT PRIMARY KEY NOT NULL,
          company_id TEXT NOT NULL REFERENCES companies(id),
          fiscal_year_id TEXT REFERENCES company_fiscal_years(id),
          kind TEXT NOT NULL CHECK (kind IN ('legal','statutory','cash')),
          name TEXT NOT NULL,
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (kind = 'cash' OR fiscal_year_id IS NOT NULL)
        );

        CREATE TABLE distribution_simulations (
          id TEXT PRIMARY KEY NOT NULL,
          company_id TEXT NOT NULL REFERENCES companies(id),
          fiscal_year_id TEXT REFERENCES company_fiscal_years(id),
          name TEXT,
          distributable_minor INTEGER NOT NULL CHECK (distributable_minor >= 0),
          ownership_bp INTEGER NOT NULL CHECK (ownership_bp BETWEEN 0 AND 10000),
          withholding_bp INTEGER NOT NULL CHECK (withholding_bp BETWEEN 0 AND 10000),
          proposed_minor INTEGER NOT NULL CHECK (proposed_minor > 0),
          owner_gross_minor INTEGER NOT NULL CHECK (owner_gross_minor >= 0),
          withholding_minor INTEGER NOT NULL CHECK (withholding_minor >= 0),
          net_minor INTEGER NOT NULL CHECK (net_minor >= 0),
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE distributions (
          id TEXT PRIMARY KEY NOT NULL,
          company_id TEXT NOT NULL REFERENCES companies(id),
          fiscal_year_id TEXT REFERENCES company_fiscal_years(id),
          simulation_id TEXT REFERENCES distribution_simulations(id) ON DELETE SET NULL,
          approved_at TEXT NOT NULL,
          total_gross_minor INTEGER NOT NULL CHECK (total_gross_minor > 0),
          ownership_bp INTEGER NOT NULL CHECK (ownership_bp BETWEEN 0 AND 10000),
          owner_gross_minor INTEGER NOT NULL CHECK (owner_gross_minor >= 0),
          withholding_bp INTEGER NOT NULL CHECK (withholding_bp BETWEEN 0 AND 10000),
          withholding_minor INTEGER NOT NULL CHECK (withholding_minor >= 0),
          net_minor INTEGER NOT NULL CHECK (net_minor >= 0),
          status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','cancelled')),
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (owner_gross_minor = withholding_minor + net_minor)
        );

        CREATE TABLE distribution_payments (
          id TEXT PRIMARY KEY NOT NULL,
          distribution_id TEXT NOT NULL REFERENCES distributions(id) ON DELETE CASCADE,
          transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
          created_at TEXT NOT NULL
        );

        CREATE TABLE company_liabilities (
          id TEXT PRIMARY KEY NOT NULL,
          company_id TEXT NOT NULL REFERENCES companies(id),
          fiscal_year_id TEXT REFERENCES company_fiscal_years(id),
          distribution_id TEXT REFERENCES distributions(id),
          kind TEXT NOT NULL CHECK (kind IN ('is','tva','payroll','supplier','cnss','withholding','dividend','other')),
          label TEXT NOT NULL,
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          currency TEXT NOT NULL DEFAULT 'MAD',
          due_date TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE company_liability_payments (
          id TEXT PRIMARY KEY NOT NULL,
          liability_id TEXT NOT NULL REFERENCES company_liabilities(id) ON DELETE CASCADE,
          transaction_id TEXT NOT NULL REFERENCES transactions(id),
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          created_at TEXT NOT NULL,
          UNIQUE (liability_id, transaction_id)
        );

        CREATE INDEX idx_fiscal_years_company ON company_fiscal_years(company_id, start_date);
        CREATE INDEX idx_tax_items_fy ON tax_items(fiscal_year_id);
        CREATE INDEX idx_reserves_company ON company_reserves(company_id);
        CREATE INDEX idx_simulations_company ON distribution_simulations(company_id);
        CREATE INDEX idx_distributions_company ON distributions(company_id, approved_at);
        CREATE INDEX idx_liabilities_company ON company_liabilities(company_id, due_date);
        CREATE INDEX idx_liabilities_distribution ON company_liabilities(distribution_id);
        CREATE INDEX idx_liability_payments_tx ON company_liability_payments(transaction_id);
        CREATE INDEX idx_accounts_company ON accounts(company_id);
      `);

      const ts = now();
      for (const c of COMPANY_CATEGORIES) {
        await tx.run(
          `INSERT OR IGNORE INTO categories (id, name, kind, parent_id, icon, color, essential, sort_order, is_system, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, NULL, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories), 1, ?, ?)`,
          [c.id, c.name, c.kind, c.icon, c.color, ts, ts],
        );
      }
    },
  },
  {
    version: 4,
    name: 'backup: sync_meta, backups, change tracking',
    up: async (tx) => {
      await tx.exec(`
        CREATE TABLE sync_meta (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          device_id TEXT NOT NULL,
          change_seq INTEGER NOT NULL DEFAULT 0,
          last_change_at TEXT,
          baseline_seq INTEGER,
          baseline_backup_id TEXT,
          baseline_created_at TEXT,
          baseline_device_id TEXT,
          baseline_sha256 TEXT,
          last_backup_at TEXT,
          last_restore_at TEXT,
          last_restore_source TEXT,
          recovery_at TEXT,
          recovery_label TEXT,
          recovery_sha256 TEXT,
          recovery_size INTEGER,
          keep_backups INTEGER NOT NULL DEFAULT 10 CHECK (keep_backups BETWEEN 1 AND 100),
          account_email TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE backups (
          id TEXT PRIMARY KEY NOT NULL,
          created_at TEXT NOT NULL,
          drive_file_id TEXT UNIQUE,
          account_email TEXT,
          schema_version INTEGER NOT NULL,
          app_version TEXT,
          sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
          size INTEGER NOT NULL CHECK (size > 0),
          device_id TEXT NOT NULL,
          device_name TEXT,
          row_counts TEXT NOT NULL,
          change_seq INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('verified','deleted')),
          verified_at TEXT,
          deleted_at TEXT
        );

        CREATE INDEX idx_backups_created ON backups(created_at);
      `);
      const ts = now();
      await tx.run(
        `INSERT INTO sync_meta (id, device_id, created_at, updated_at) VALUES (1, lower(hex(randomblob(16))), ?, ?)`,
        [ts, ts],
      );
      const tables = await tx.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );
      for (const t of tables) {
        if (UNTRACKED_TABLES.includes(t.name)) continue;
        await tx.exec(changeTriggersSql(t.name));
      }
    },
  },
  {
    version: 5,
    name: 'recurring bills, expected payments, debts and receivables',
    rebuildsTables: true,
    up: async (tx) => {
      // 1. Rebuild `transactions` so its kind CHECK allows 'debt' (loan principal moving in or out).
      // SQLite cannot alter a CHECK in place. Same columns in the same order; rows copied in rowid
      // order; indexes and triggers recreated from their stored SQL.
      const before = await tx.all<{ name: string }>(`SELECT name FROM pragma_table_info('transactions') ORDER BY cid`);
      const extras = await tx.all<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE tbl_name = 'transactions' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type, name`,
      );
      await tx.exec(`
        CREATE TABLE transactions_v5 (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('expense','income','transfer','adjustment','debt')),
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
      `);
      const after = await tx.all<{ name: string }>(`SELECT name FROM pragma_table_info('transactions_v5') ORDER BY cid`);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error('transactions has unexpected columns; the v5 rebuild was not applied');
      }
      const cols = before.map((c) => c.name).join(', ');
      const rows = (await tx.first<{ n: number }>('SELECT COUNT(*) AS n FROM transactions'))?.n ?? 0;
      await tx.exec(`
        INSERT INTO transactions_v5 (${cols}) SELECT ${cols} FROM transactions ORDER BY rowid;
        DROP TABLE transactions;
        ALTER TABLE transactions_v5 RENAME TO transactions;
      `);
      for (const e of extras) await tx.exec(e.sql);
      const copied = (await tx.first<{ n: number }>('SELECT COUNT(*) AS n FROM transactions'))?.n ?? 0;
      if (copied !== rows) throw new Error(`transactions rebuild copied ${copied} of ${rows} rows`);

      // 2. Debts and receivables (personal). Never money: the money moves in `debt` transactions
      // (principal, not income or expense) or in linked expenses/income.
      await tx.exec(`
        CREATE TABLE debts (
          id TEXT PRIMARY KEY NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('owe','owed')),
          counterparty TEXT NOT NULL,
          principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
          currency TEXT NOT NULL DEFAULT 'MAD',
          start_date TEXT NOT NULL,
          due_date TEXT,
          origin_transaction_id TEXT UNIQUE REFERENCES transactions(id),
          notes TEXT,
          closed_at TEXT,
          close_note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE debt_payments (
          id TEXT PRIMARY KEY NOT NULL,
          debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
          transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          created_at TEXT NOT NULL
        );

        CREATE TABLE recurring_rules (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('expense','income')),
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          account_id TEXT NOT NULL REFERENCES accounts(id),
          category_id TEXT REFERENCES categories(id),
          payee TEXT,
          debt_id TEXT REFERENCES debts(id) ON DELETE SET NULL,
          interval_unit TEXT NOT NULL CHECK (interval_unit IN ('day','week','month','year')),
          interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 366),
          start_date TEXT NOT NULL,
          end_date TEXT,
          remind_days_before INTEGER NOT NULL DEFAULT 3 CHECK (remind_days_before BETWEEN 0 AND 60),
          reserve INTEGER NOT NULL DEFAULT 1 CHECK (reserve IN (0,1)),
          is_paused INTEGER NOT NULL DEFAULT 0 CHECK (is_paused IN (0,1)),
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (end_date IS NULL OR end_date >= start_date)
        );

        CREATE TABLE expected_payments (
          id TEXT PRIMARY KEY NOT NULL,
          rule_id TEXT REFERENCES recurring_rules(id) ON DELETE CASCADE,
          due_date TEXT NOT NULL,
          name TEXT,
          direction TEXT CHECK (direction IS NULL OR direction IN ('expense','income')),
          account_id TEXT REFERENCES accounts(id),
          category_id TEXT REFERENCES categories(id),
          amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor > 0),
          reserve INTEGER CHECK (reserve IS NULL OR reserve IN (0,1)),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','skipped')),
          transaction_id TEXT UNIQUE REFERENCES transactions(id),
          resolved_at TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (rule_id, due_date),
          CHECK (rule_id IS NOT NULL OR (name IS NOT NULL AND direction IS NOT NULL AND account_id IS NOT NULL
                                         AND amount_minor IS NOT NULL AND reserve IS NOT NULL)),
          CHECK ((status = 'paid') = (transaction_id IS NOT NULL))
        );

        -- Company payout estimate: 'detailed' (fiscal years, tax assumptions) or 'simple' (one
        -- entered share of current company money, for when accountant figures are not available).
        ALTER TABLE companies ADD COLUMN payout_mode TEXT NOT NULL DEFAULT 'detailed' CHECK (payout_mode IN ('detailed','simple'));
        ALTER TABLE companies ADD COLUMN simple_payout_bp INTEGER CHECK (simple_payout_bp IS NULL OR simple_payout_bp BETWEEN 0 AND 10000);

        CREATE INDEX idx_debt_payments_debt ON debt_payments(debt_id);
        CREATE INDEX idx_rules_account ON recurring_rules(account_id);
        CREATE INDEX idx_rules_debt ON recurring_rules(debt_id);
        CREATE INDEX idx_expected_due ON expected_payments(due_date);
        CREATE INDEX idx_expected_account ON expected_payments(account_id);
      `);
      for (const t of ['debts', 'debt_payments', 'recurring_rules', 'expected_payments']) {
        await tx.exec(changeTriggersSql(t));
      }

      const ts = now();
      for (const c of DEBT_CATEGORIES) {
        await tx.run(
          `INSERT OR IGNORE INTO categories (id, name, kind, parent_id, icon, color, essential, sort_order, is_system, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, NULL, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories), 1, ?, ?)`,
          [c.id, c.name, c.kind, c.icon, c.color, ts, ts],
        );
      }
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Applies pending migrations, each in its own transaction. Refuses databases from a newer app.
 * `to` stops at an older version (used by tests to build a database as an earlier release left it).
 */
export async function migrate(db: Db, to: number = SCHEMA_VERSION): Promise<number> {
  await db.exec('PRAGMA foreign_keys = ON');
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${current} is newer than this app (v${SCHEMA_VERSION}). Update the app before opening this data.`,
    );
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current || m.version > to) continue;
    if (m.rebuildsTables) await db.exec('PRAGMA foreign_keys = OFF');
    try {
      await db.transaction(async (tx) => {
        await m.up(tx);
        if (m.rebuildsTables) {
          const broken = await tx.all<{ table: string }>('PRAGMA foreign_key_check');
          if (broken.length) {
            throw new Error(`Migration v${m.version} left ${broken.length} broken references (first in ${broken[0].table}); nothing was changed.`);
          }
        }
        await tx.exec(`PRAGMA user_version = ${m.version}`);
      });
    } finally {
      if (m.rebuildsTables) await db.exec('PRAGMA foreign_keys = ON');
    }
  }
  return Math.max(current, Math.min(to, SCHEMA_VERSION));
}
