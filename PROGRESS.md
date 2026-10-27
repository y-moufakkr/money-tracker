# Progress

Last updated: 2026-10-27

| Phase | Status |
|---|---|
| 1 — Core financial tracking | ✅ Done (see verification below) |
| 2 — Analytics & savings | ⏳ Next |
| 3 — Company money | Not started (separation groundwork done in Phase 1) |
| 4 — Google Sign-In & Drive backup | Not started |
| 5 — Recurring, debts, attachments, polish | Not started |

## Phase 1 — delivered

**Ledger & data**
- SQLite schema v1 with migrations (`PRAGMA user_version`), WAL, foreign keys, indexes, UUID keys and integer minor units. See [src/db/migrations.ts](src/db/migrations.ts).
- One ledger service for all writes ([src/services/ledger.ts](src/services/ledger.ts)). Each operation runs in one SQLite transaction behind a write queue ([src/db/core.ts](src/db/core.ts)).
- Balances are always derived (opening + postings), in one place: [src/services/balances.ts](src/services/balances.ts).
- Money locations: bank, cash, savings, prepaid, mobile wallet, credit card and other. Each is personal or company-owned, with its own currency, opening balance + date, institution and notes, and can be archived.
- Debit cards are linked to an account and never hold money. Credit cards are liabilities. Prepaid cards are their own locations.
- Income, expenses, transfers (with fee as a linked expense, cross-currency received amount), editing, soft deletion.
- Company ↔ personal transfers must be classified (salary, dividend, reimbursement, owner loan, …). Only salary/dividend count as personal income.
- Reconciliation: matched / open (investigate, then re-check) / adjusted (explicit adjustment transaction). Deleting an adjustment re-opens the check.
- Itemized purchases (optional, partial data allowed), discount/charge/unallocated lines, discrepancy display. Products are catalogued as you go.
- Merchants auto-created and reused case-insensitively; they remember their last category.
- Manual FX rates. Foreign locations without a rate are listed but excluded from totals, never guessed.
- Dates use the Africa/Casablanca calendar. Future-dated and pre-opening transactions are rejected.

**Screens**
- Tabs: Home, Activity, My Money, Analytics, Goals. A "+" action sheet on every tab.
- My Money: personal total, available, net after debts, bank/cash/savings/liabilities tiles, a "where it is" breakdown, quick actions, a historical "balances on date" view, and a separate company section.
- Location detail: balance, running-balance activity, linked debit cards, balance-check history, archive/delete rules.
- Fast expense entry: amount first, merchant suggestions, category chips, remembered payment source, Today/Yesterday/date picker, "Save & next", optional items + note.
- Income, transfer (with classification and balance preview), reconcile, transaction detail (edit/delete), settings (companies + ownership %, FX rates, archived locations).
- Analytics (basic): income/spending/net/savings rate per period, comparison with an explicitly labelled previous period, calendar-day vs active-day averages, category bars that drill down to transactions.

**Verification (2026-10-27)**
- `npm test`: 68 tests pass. Covered: income/expense balances, transfers preserving totals, debit cards not double-counting, prepaid and credit cards, reconciliation (matched/adjusted/open → re-check, delete re-opens), FX conversion and unconverted exclusion, edit/delete recalculation, historical balances, personal vs company separation, classified company transfers, atomic rollback, item rules, money parsing/formatting/rounding, Casablanca dates.
- `npx tsc --noEmit`: clean. `npx eslint src`: clean. `npx expo-doctor`: 20/20.
- `npx expo export --platform android`: Hermes bundle builds.
- Manual run in the web build (real expo-sqlite/WASM), following the brief's example: 5 locations → personal 40,800 DH, company 100,000 DH separate; a 100 DH Moul Lkhodra expense with items lowers Wallet to 700 DH; an 8,000 DH company → personal salary counts as income; a wallet check at 650 DH records a −50 DH adjustment. Breakdown 49/37/12/2 % matches the brief.
- **Not yet verified on a physical Android device.** No JDK or adb on this Mac — see README.

## Known gaps / decisions

- Goals tab shows savings accounts and explains Phase 2; it has no goal creation yet. `reserved` is 0 until goal allocations exist.
- Category management (create/rename/merge), tags and a merchant/product catalog UI are Phase 2. The data is already captured.
- Phase 1 analytics are personal-only. Company P&L comes in Phase 3.
- Drill-down from "Uncategorised" opens all transactions for the period (no "no category" filter yet).
- Day totals in Activity only add up MAD expenses.
- Debit cards are offered for bank, savings and mobile wallet accounts. Prepaid/credit "instruments" aren't needed because those are their own locations.
- Release builds are signed with the debug key until a real keystore is created (needed before Phase 4).

## Next (Phase 2)

1. Migration v2: tags, transaction/item tags, budgets, savings goals, goal allocations.
2. Category management (hierarchy, rename, merge, archive), merchant/product rename & merge.
3. Product catalog & price history (normalised unit prices, merchant comparison).
4. Budgets with threshold warnings, goals with allocations capped by real balances.
5. Balance trend charts (daily/weekly/monthly/yearly) using `accountBalances(asOf)`.
6. Rule-based insights with explained calculations.
