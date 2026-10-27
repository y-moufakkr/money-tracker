# Money Tracker — Architecture Plan

Android-first, offline-first personal + SARL finance app. Source requirements: [project.md](project.md).

Guiding rule: **one dirham is never counted twice.** Every balance is derived from a single ledger; nothing else stores money.

## Stack (verified October 2026)

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Expo SDK 58, React Native 0.88, React 19.3, TypeScript 6 | `npx expo install` for all native deps |
| Navigation | Expo Router 58, `NativeTabs` (Material bottom nav on Android, max 5 tabs) + root `Stack` for detail screens and modals | Routes live in `src/app/` |
| Storage | `expo-sqlite` 58, WAL mode, `PRAGMA foreign_keys = ON` | Runs in Expo Go for Phase 1–3 |
| Server state | TanStack Query 5: every DB read is a query; every write invalidates the `['ledger']` key | |
| UI state | Zustand 5 (small UI prefs) | |
| Icons | `expo-symbols` (Material Symbols font on Android) | `@expo/vector-icons` is no longer in the SDK |
| Dates | `@react-native-community/datetimepicker` (native Android dialog) | |
| IDs | `expo-crypto` `randomUUID()` | UUID v4 text keys everywhere |
| Tests | `jest-expo` preset; DB tests use Node's built-in `node:sqlite` behind the same `Db` interface the app uses | No native modules are needed in tests |
| Auth/backup (Phase 4) | `@react-native-google-signin/google-signin` + Drive REST API, scope `drive.appdata` only | Needs a development build, not Expo Go |

## Source layout

```
src/
  app/                 Expo Router routes only (screens)
    (tabs)/            Home, Transactions, My Money, Analytics, Goals
    accounts/          new, [id] detail, [id]/edit, [id]/reconcile
    entry/             expense, income, transfer (create + edit via ?id=)
    transactions/[id]  transaction detail
  db/                  Db interface, expo adapter, migrations, seed data
  domain/              pure logic: money (minor units, parsing, formatting, FX), dates (Africa/Casablanca), types
  services/            ledger (all writes), balances (all balance maths), queries (reads for lists/analytics)
  hooks/               TanStack Query hooks wrapping services
  ui/                  design system: theme tokens, Text, Card, Button, Chip, inputs, Icon, FAB
  test/                node:sqlite adapter for tests
```

Services take a `Db` argument (`run`, `all`, `first`, `exec`, `transaction`), so the same code runs on the phone (expo-sqlite) and in Jest (node:sqlite).

## Money representation

- All amounts are **signed integers in minor units** (centimes for MAD). No floats are stored.
- Each account has one currency. A posting's amount is always in its account's currency.
- Currency metadata (decimals, symbol) lives in `domain/money.ts`. MAD is the base currency.
- FX: user-entered rates in `fx_rates` (`rate_micros` = base units per 1 foreign unit × 10⁶). Totals convert foreign accounts with the latest rate. Accounts with no rate are **listed as unconverted and left out of totals**, never guessed.
- Quantities (itemized purchases) are stored as integer thousandths (`quantity_milli`).

## Ledger model

A **transaction** is the event (header). **Postings** are its effects on money locations. A balance is:

```
balance(account, asOf) = opening_balance + Σ postings.amount (transaction not deleted, date ≤ asOf, date ≥ opening_date)
```

| Kind | Postings | Counts as income/expense? |
|---|---|---|
| `expense` | 1 × negative on the paying account | Expense |
| `income` | 1 × positive on the destination account | Income |
| `transfer` | negative on source + positive on destination (amounts may differ across currencies) | No. A fee is a separate linked `expense` (category "Bank fees") |
| `adjustment` | 1 × signed on the account, always linked to a reconciliation | No. Reported separately as "Balance adjustments" |

Rules enforced in `services/ledger.ts`:
- All multi-row writes happen in one SQLite transaction (atomic transfers, edits, deletes).
- A transfer requires two different, active accounts.
- **Cross-ownership transfers** (business ↔ personal) require a `transfer_class`: `salary`, `dividend`, `expense_reimbursement`, `owner_loan`, `loan_repayment`, `capital_contribution`, `other`. Same-owner transfers are `internal`.
- In personal reporting, business → personal `salary` and `dividend` transfers count as personal income (labelled with their class). Reimbursements and loan repayments do not. Nothing is assumed tax-free.
- Edits replace a transaction's postings inside one DB transaction. Deletes are soft (`deleted_at`) and cascade to linked fee transactions. Balances are always recomputed from postings, so edits and deletes recalculate automatically.
- Balances are never overwritten. A reconciliation stores the statement balance and the calculated balance. If they differ, the user either leaves it open to investigate or records an explicit `adjustment` transaction.

### Cards (no double counting by construction)

`payment_instruments` never hold money. Every instrument points at an account:
- **Debit card** → the linked bank account. Paying with it posts to the bank account.
- **Credit card** → an account of kind `credit_card` (a liability; a negative balance means money owed).
- **Prepaid card** → an account of kind `prepaid` with its own balance (a real money location).

### Personal vs business

`accounts.ownership` is `personal` or `business` (business accounts reference a `company`). Every summary is computed per ownership, and personal totals never include business accounts. Potential distributions (Phase 3) live in separate tables and never touch account balances until a real transfer is recorded.

### My Money metrics (personal, base currency)

| Metric | Definition |
|---|---|
| Bank | Σ `bank` accounts |
| Cash | Σ `cash` accounts (wallet, home, …) |
| Savings | Σ `savings` accounts |
| Other liquid | Σ `prepaid`, `ewallet`, `other` |
| Liquid assets | Bank + Cash + Savings + Other liquid |
| Reserved | goal and bill reservations (Phase 2; 0 until then) |
| Available | Liquid assets − Reserved |
| Liabilities | Σ owed on `credit_card` accounts (+ debts in Phase 5) |
| Net liquid position | Liquid assets − Liabilities |

A negative balance on a non-credit account (an overdraft) stays in its group as a negative number and is not hidden.

## Database schema

Migrations are numbered and tracked with `PRAGMA user_version`. Each migration runs inside a transaction. All tables have UUID `id TEXT PRIMARY KEY`, `created_at`/`updated_at` (UTC ISO) for future sync.

### v1 — Phase 1 (implemented)

- `settings(key, value)`
- `companies(id, name, legal_form, ownership_bp, ice, fiscal_year_start_month, currency, notes)`. `ownership_bp` is basis points (9500 = 95%).
- `accounts(id, name, kind, ownership, company_id→companies, currency, opening_balance_minor, opening_date, institution, notes, color, icon, sort_order, is_archived)`
  - `kind ∈ bank|cash|savings|prepaid|ewallet|credit_card|other`, CHECK `ownership='business'` ⇒ `company_id` not null
- `payment_instruments(id, name, kind ∈ debit|credit|prepaid, account_id→accounts, last4, is_archived)`
- `categories(id, name, kind ∈ expense|income, parent_id→categories, icon, color, essential, sort_order, is_system, is_archived)`
- `merchants(id, name UNIQUE NOCASE, default_category_id, address, notes, is_archived)`
- `products(id, name UNIQUE NOCASE, default_unit, category_id)`. Catalog rows are created from itemized purchases now; the catalog UI comes in Phase 2.
- `transactions(id, kind, date 'YYYY-MM-DD' Casablanca, amount_minor > 0, currency, category_id, merchant_id, instrument_id, transfer_class, parent_id→transactions (fee link), note, deleted_at)`
- `postings(id, transaction_id→transactions CASCADE, account_id→accounts, amount_minor signed, role ∈ main|from|to)`
- `purchase_items(id, transaction_id CASCADE, product_id, line_kind ∈ product|discount|charge|unallocated, name, quantity_milli, unit, unit_price_minor, total_minor, category_id, notes, sort_order)`
- `reconciliations(id, account_id, date, statement_balance_minor, calculated_balance_minor, difference_minor, status ∈ matched|open|adjusted, adjustment_transaction_id, note, resolved_at)`
- `fx_rates(id, currency, rate_micros, as_of)`
- Indexes: `postings(account_id)`, `postings(transaction_id)`, `transactions(date)`, `transactions(kind, date)`, `transactions(category_id)`, `transactions(merchant_id)`, `purchase_items(transaction_id)`, `purchase_items(product_id)`

### Later migrations (planned)

- **v2 (Phase 2)**: `tags`, `transaction_tags`, `item_tags`, `category_groups`, `budgets`, `budget_lines`, `savings_goals`, `goal_allocations(goal_id, account_id, amount_minor)`. Allocations reserve part of a real account. They are capped by that account's balance (with an explicit warning) and never add to totals.
- **v3 (Phase 3)**: `company_fiscal_years`, `company_liabilities(kind ∈ is|tva|payroll|supplier|cnss|other, amount, due, paid)`, `company_reserves`, `tax_assumptions(fiscal_year, key, value, source_note)`, `distribution_simulations`, `distributions(approved_at, gross, withholding, net, paid_transaction_id)`
- **v4 (Phase 4)**: `backups(id, created_at, drive_file_id, schema_version, sha256, size, device)`, `sync_meta(device_id, last_backup_at)`
- **v5 (Phase 5)**: `recurring_rules`, `expected_payments`, `debts(direction ∈ owe|owed, counterparty, principal, due)`, `debt_payments`, `attachments(transaction_id, uri, mime, sha256)`

## Company module (Phase 3) rules

- Bank balance ≠ profit ≠ distributable profit ≠ approved distribution ≠ received distribution. Each is a separate figure.
- Tax rates are user-entered per fiscal year, with an optional "assumption source" note. Built-in defaults are added only when verified for that fiscal year. Every estimate is editable.
- Simulator output is labelled **"Estimated potential personal payout — not yet personal money"**, stored separately, and excluded from personal totals.
- The three-totals overview (A personal, B company, C potential) never sums A + B + C.

## Backup (Phase 4)

- Snapshot: `PRAGMA wal_checkpoint(TRUNCATE)` then `VACUUM INTO` a temp file (consistent even in WAL mode). Compute SHA-256, then upload to Drive `appDataFolder` with metadata (schema version, device, created_at, row counts).
- Restore: download, verify the hash, open the file read-only and check `user_version` ≤ app schema plus `PRAGMA integrity_check`. Then keep a local recovery copy, swap the files, and run migrations.
- Divergence: if the local DB changed after the last backup and the remote is from another device, warn and require an explicit choice. This is backup/restore, **not** live sync, and the UI says so.

## Phases

1. Core ledger, accounts, cards, income/expense/transfer, reconciliation, fast entry, itemized purchases, history, My Money ← **current**
2. Analytics, catalog and price history, tags, budgets, goals and allocations, historical balances, insights
3. SARL dashboard, obligations, tax estimates, distribution simulator
4. Google Sign-In, Drive backup/restore, CSV/JSON export
5. Recurring bills, debts, attachments, notifications, OCR evaluation, polish
