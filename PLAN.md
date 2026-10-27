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
| Charts | `react-native-svg` (in Expo Go) for line charts; plain Views for bars, columns and meters | No chart library |
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
    company/           [id] SARL dashboard, [id]/tax, [id]/obligations, [id]/simulate, [id]/distributions,
                       [id]/analytics, obligation/[id], distribution/[id], modals (assumptions, fiscal-year,
                       obligation-edit, reserve-edit, approve)
  db/                  Db interface, expo adapter, migrations, seed data
  domain/              pure logic: money (minor units, parsing, formatting, FX), dates (Africa/Casablanca), types
  services/            ledger (money writes), balances (all balance + reservation maths), queries (lists),
                       catalog (categories/merchants/products/tags), goals, budgets, analytics, insights,
                       company (fiscal years, assumptions, reserves, P&L, tax estimate), obligations,
                       distributions, overview (SARL dashboard + three totals), company-analytics
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
| Reserved | goal reservations backed by real balances (bills: Phase 5) |
| Available | Liquid assets − Reserved ("unallocated") |
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

### v2 — Phase 2 (implemented)

- `tags(id, name UNIQUE NOCASE, color, is_archived)`
- `transaction_tags(transaction_id→transactions CASCADE, tag_id→tags CASCADE, PK both)` and `item_tags(item_id→purchase_items CASCADE, tag_id→tags CASCADE, PK both)`. A tag can be attached once per transaction/line.
- `budgets(id, name, period ∈ weekly|monthly|custom, start_date, end_date, amount_minor NULL = sum of lines, currency, thresholds '75,90,100', is_archived)`, CHECK custom ⇒ both dates.
- `budget_lines(id, budget_id→budgets CASCADE, category_id→categories, amount_minor > 0, UNIQUE(budget_id, category_id))`
- `savings_goals(id, name, target_minor > 0, currency, target_date, monthly_plan_minor, icon, color, notes, sort_order)`
- `goal_allocations(id, goal_id→savings_goals CASCADE, account_id→accounts, amount_minor > 0, UNIQUE(goal_id, account_id))`. The amount is in the account's currency and is the current reserved total (setting it replaces, never adds).
- Indexes: `transaction_tags(tag_id)`, `item_tags(tag_id)`, `categories(parent_id)`, `budget_lines(budget_id)`, `goal_allocations(account_id)`
- **Dropped from the plan:** `category_groups`. Parent categories (one level of subcategories) are the groups.

### Phase 2 rules

- **Allocations** reserve part of a real personal, non-credit account. They never move money and never add to totals. What an account backs is `min(Σ allocations, max(balance, 0))`. When it holds less than is allocated, the money it holds is split pro rata between its goals (largest remainder, exact). My Money: `liquid = reserved + unallocated`. Reserving more than the unallocated balance throws `OverAllocationError` unless the user explicitly confirms; lowering is always allowed. Archiving or deleting a location releases its allocations. Reservations exist only in the present: historical views report 0.
- **Tags**: a tagged transaction contributes its whole paid amount to the tag. Otherwise its tagged item lines do (discounts subtract), capped at the amount paid. A transaction appears under each of its tags, but every total counts it once.
- **Budgets**: actual = recorded personal expenses in the period (MAD). A category line covers the category and those of its subcategories that have no line of their own, so lines never overlap. "Everything else" = overall limit − Σ lines. Projection = spent ÷ days elapsed × days in period. Budgets never touch transactions.
- **Products**: quantities and prices are compared only within one unit group (mass kg/g, volume L/cl/ml, count piece/dozen, or one incomparable unit such as "pack"). Average price = Σ amount ÷ Σ quantity of lines that have both. Nothing is converted by guessing.
- **Analytics** load personal expenses once as "facts" (`services/analytics.ts`) and derive every breakdown with pure functions. Each breakdown row carries the `TransactionFilter` that lists exactly its transactions.
- **Merges** (category, merchant, product, tag) re-point all history in one SQLite transaction, then remove the source. Item lines keep the name/unit they were recorded with. System categories cannot be archived or merged away.

### v3 — Phase 3 (implemented)

- `companies` gains `tva_mode ∈ ttc|ht` (default `ttc`): whether recorded company amounts include TVA.
- `company_fiscal_years(id, company_id, label, start_date, end_date, is_closed, notes)`, UNIQUE(company_id, start_date); overlaps are refused by the service.
- `tax_assumptions(id, fiscal_year_id UNIQUE → CASCADE, is_rate_bp, is_minimum_minor, is_override_minor, is_paid_outside_minor, withholding_rate_bp, legal_reserve_rate_bp, tva_collected_minor, tva_deductible_minor, pre_tracking_revenue_minor, pre_tracking_expenses_minor, retained_earnings_minor, source_note)`. One typed row per fiscal year instead of the planned key/value table. **NULL means "not entered"**, never 0.
- `tax_items(id, fiscal_year_id → CASCADE, kind ∈ adjustment|other_tax, label, amount_minor, rate_bp, base ∈ revenue|taxable_profit, source_note)`: taxable-profit adjustments (signed) and other configurable taxes (amount, or rate × base).
- `company_reserves(id, company_id, fiscal_year_id, kind ∈ legal|statutory|cash, name, amount_minor, notes)`, CHECK profit reserves have a fiscal year.
- `distribution_simulations(id, company_id, fiscal_year_id, name, distributable_minor, ownership_bp, withholding_bp, proposed_minor, owner_gross_minor, withholding_minor, net_minor, notes)`.
- `distributions(id, company_id, fiscal_year_id, simulation_id, approved_at, total_gross_minor, ownership_bp, owner_gross_minor, withholding_bp, withholding_minor, net_minor, status ∈ approved|cancelled, notes)`, CHECK owner_gross = withholding + net.
- `distribution_payments(id, distribution_id → CASCADE, transaction_id UNIQUE)`: replaces the planned single `paid_transaction_id`, so a distribution can be paid in several transfers; UNIQUE keeps a transfer from paying two distributions.
- `company_liabilities(id, company_id, fiscal_year_id, distribution_id, kind ∈ is|tva|payroll|supplier|cnss|withholding|dividend|other, label, amount_minor, currency, due_date, notes)`. Two kinds were added to the plan: `withholding` and `dividend` (other partners' shares), created by an approval. There is no `paid` column: paid/outstanding are derived from payments.
- `company_liability_payments(id, liability_id → CASCADE, transaction_id, amount_minor, UNIQUE(liability_id, transaction_id))`: the part of a real transaction that pays an obligation.
- Nine system categories (`sys-cat-co-*`): payroll, CNSS, IS, TVA paid, dividend withholding, dividends to other partners, loan principal (expense); sales & revenue, capital/loans/refunds (income). They live in `COMPANY_CATEGORIES` (not `DEFAULT_CATEGORIES`) so migration v1 never changes.
- Indexes on fiscal years, tax items, reserves, simulations, distributions, liabilities, liability payments (by transaction) and `accounts(company_id)`.
- Rates and shares are integer basis points (`2000` = 20 %), applied with `applyBp` (BigInt, half away from zero) in `domain/money.ts`.

### Later migrations (planned)

- **v4 (Phase 4)**: `backups(id, created_at, drive_file_id, schema_version, sha256, size, device)`, `sync_meta(device_id, last_backup_at)`
- **v5 (Phase 5)**: `recurring_rules`, `expected_payments`, `debts(direction ∈ owe|owed, counterparty, principal, due)`, `debt_payments`, `attachments(transaction_id, uri, mime, sha256)`

## Company module (Phase 3) rules

- Bank balance ≠ accounting profit ≠ distributable profit ≠ approved distribution ≠ received distribution. Each is a separate, labelled figure. Ownership % is a share of what the partners distribute, never a right to company cash.
- **No tax rate is built in.** IS, withholding, legal-reserve and other rates are user-entered per fiscal year with a "source" note. A missing input makes the estimate say what is missing; nothing is guessed. Every estimate step shows its calculation and whether it is recorded, entered or calculated.
- **P&L** (cash basis, per company, from `loadExpenseFacts(…, 'business', { companyId })`): revenue = income except "capital, loans & refunds"; costs = expenses except IS, TVA paid, dividend withholding, dividends to other partners and loan principal, **plus** company → you `salary` and `expense_reimbursement` transfers (a company cost; personal income/refund on your side — one movement, counted once in each entity). Dividends, owner loans, loan repayments, capital contributions, internal and other transfers, and balance adjustments are never revenue or cost; they are listed separately with their reason and drill-down.
- **TVA**: companies are `ttc` (recorded bank amounts include TVA) or `ht` (no TVA in recorded amounts). For `ttc`, the TVA collected and the deductible TVA of the year are user-entered and removed from revenue/expenses; TVA paid to the state is an obligation, never a cost.
- **Data sufficiency**: accounting profit is shown only when the year has recorded (or entered) activity, every company location existed from the start of the year (or pre-tracking figures were entered), TVA amounts are entered for `ttc`, and every currency converts. Otherwise the dashboard says "Not enough data" and why.
- **Tax estimate**: revenue HT − costs HT = accounting profit; + adjustments = taxable profit; × IS rate (or the higher minimum, or an entered amount) = IS; − advances (payments linked to that year's IS obligations + IS paid outside the app) = IS still to pay; profit − IS − other taxes = profit after tax; − profit reserves (recorded, or rate × profit after tax) ± retained earnings brought forward = distributable profit (never below 0); − approved distributions of that year = not yet distributed. Earlier years only count through the retained-earnings figure, so no profit is counted twice.
- **Obligations** are paid by real company expenses/transfers linked to them. Outstanding = amount − linked payments. A transaction's linked parts never exceed its amount, and a transfer that pays a distribution cannot also pay an obligation. Liquidity after obligations = cash − outstanding obligations (incl. approved dividends owed to you and company card debt) − cash reserves, so paying a linked obligation leaves it unchanged. Tax payments that are not linked are flagged (they would otherwise be subtracted twice). Estimated IS not yet recorded as an obligation is shown, not subtracted.
- **Distributions**: simulated (stored apart, no effect) → approved (a company obligation: your net share, plus withholding and other partners' shares as linked obligations; still not your money) → paid by a linked company → personal transfer classed `dividend`, which is the only thing that adds to A and to personal income. Paying above the approved net throws `OverDistributionError` unless explicitly confirmed. Warnings: dividend transfers with no approval, approvals not paid, over-payment, and linked transfers whose class changed.
- **Three totals**: A = personal liquid money; B = per company, liquidity after obligations (with cash, obligations and reserves shown); C = approved-unpaid net + an estimate from the current year's undistributed profit, capped by cash after obligations and unrecorded IS, × ownership − withholding. They are separate figures; no A + B + C exists anywhere. Scenarios ("if the approved distribution is paid") show A rising by exactly what company cash loses.
- Simulator and payout output is labelled **"Estimated potential personal payout — not yet personal money."**

## Backup (Phase 4)

- Snapshot: `PRAGMA wal_checkpoint(TRUNCATE)` then `VACUUM INTO` a temp file (consistent even in WAL mode). Compute SHA-256, then upload to Drive `appDataFolder` with metadata (schema version, device, created_at, row counts).
- Restore: download, verify the hash, open the file read-only and check `user_version` ≤ app schema plus `PRAGMA integrity_check`. Then keep a local recovery copy, swap the files, and run migrations.
- Divergence: if the local DB changed after the last backup and the remote is from another device, warn and require an explicit choice. This is backup/restore, **not** live sync, and the UI says so.

## Phases

1. Core ledger, accounts, cards, income/expense/transfer, reconciliation, fast entry, itemized purchases, history, My Money ✅
2. Analytics, catalog and price history, tags, budgets, goals and allocations, historical balances, insights ✅
3. SARL dashboard, obligations, tax estimates, distribution simulator ✅
4. Google Sign-In, Drive backup/restore, CSV/JSON export ← **next**
5. Recurring bills, debts, attachments, notifications, OCR evaluation, polish
