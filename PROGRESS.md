# Progress

Last updated: 2026-10-27

| Phase | Status |
|---|---|
| 1 — Core financial tracking | ✅ Done (see verification below) |
| 2 — Analytics & savings | ✅ Done (branch `phase-2`, see below) |
| 3 — Company money | ⏳ Next (separation groundwork done in Phase 1) |
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

## Phase 2 — delivered

**Data (migration v2, see [PLAN.md](PLAN.md#v2--phase-2-implemented))**
- New tables: tags, transaction/item tags, budgets + budget lines, savings goals, goal allocations. Migration v1 is unchanged. The upgrade is tested on a v1 database that already holds accounts, items and transfers: every row, balance and period summary is identical afterwards.

**Services** (all writes in `db.transaction`, every rule tested)
- [catalog.ts](src/services/catalog.ts): categories with one level of subcategories, rename, essential/discretionary flag (subcategories inherit), archive (cascades to subcategories), and merge. Merge re-points transactions, item lines, merchant/product defaults, subcategories and budget lines; budget lines for both categories are added together. Merchant, product and tag rename and merge never lose history. System categories cannot be archived or merged away.
- [goals.ts](src/services/goals.ts) + [balances.ts](src/services/balances.ts): goals, allocations, and `OverAllocationError` with explicit consent. Goal progress only counts money the account actually holds; a shortfall is split pro rata. `moneySummary` now reports `reserved`, `available` (unallocated) and `overAllocated`. Historical summaries include since-archived locations (this fixes a Phase 1 inaccuracy) and report no reservations. `balanceHistory(dates)` reuses the same calculation.
- [budgets.ts](src/services/budgets.ts): weekly, monthly or custom periods; overall limit and/or category lines; thresholds; budget vs actual, remaining, % used, days left, linear projection, "everything else".
- [analytics.ts](src/services/analytics.ts): expense facts plus pure breakdowns by category, subcategory, tag, merchant, product, location and essential. Overlapping tags never double count. Product price history uses unit normalisation ([units.ts](src/domain/units.ts)), with merchant comparison and purchase frequency. Also merchant stats: total, monthly, visits, average ticket.
- [insights.ts](src/services/insights.ts): rule-based insights (top categories, changes vs the same days last month, daily average, essential share, quantity bought, cheapest price, budget warnings, goals behind plan). Each one carries its calculation and a drill-down.
- `listTransactions` gained filters for uncategorised, subcategories, tag/untagged, product, merchant/none and essential class. This closes the Phase 1 "Uncategorised" drill-down gap.

**Screens**
- Analytics: presets + custom date range; spending averages (calendar day, active day, week, month); insights; budgets; breakdown by every dimension. Each row opens its exact transactions, or "Analyse only this" filters the whole breakdown. Also essential vs discretionary, a personal-money trend (daily/weekly/monthly/yearly), and Explore links.
- Goals tab: reserved / personal / unallocated, goals with progress and the monthly amount needed. Goal detail lets you reserve, change or release money per account, with a live "available" figure and confirmation before over-allocating.
- My Money: reserved and unallocated figures, an over-allocation warning, plus Trends and Goals shortcuts. Location detail shows reservations per goal and a Trend button.
- Home: reserved/unallocated, the first budget (spending vs remaining), the top 3 insights, and top-spending bars that now open their transactions.
- New: Budgets (list + editor), Products (list + detail with per-unit price chart and merchant comparison), Merchants (list + detail with monthly columns), Categories (hierarchy, essential, icon/colour, archive, merge), Tags, Balance trends (personal, net, or any location, with a value table).
- Expense entry: multi-select tags with inline creation; per-item tags. Transaction detail shows tags and links items to their product.
- Charts: [charts.tsx](src/components/charts.tsx) — SVG line chart with tap-to-inspect, plus View-based columns and threshold meters. No chart library.

**Verification (2026-10-27)**
- `npm test`: 114 tests in 9 suites (68 from Phase 1 + 46 new). New coverage:
  - Goals and allocations: no double counting; re-allocation replaces; over-allocation refused without consent and capped with it; pro-rata shortfall; overdraft backs nothing; release on archive/delete; historical views; foreign currency without a rate; plan maths.
  - Tags and breakdowns: tag overlap (whole-transaction vs item tags, capping, untagged); subcategory rollup; uncategorised drill-down; essential inheritance; merchant/account/product breakdowns; business spending excluded.
  - Products and budgets: unit normalisation (kg/g, L/cl/ml, dozen) and incompatible units kept apart; weighted merchant averages; budget maths (projection, days left, non-overlapping lines, thresholds); changing or deleting a budget leaves transactions byte-identical.
  - Catalog and migration: category merge keeping history; merchant/product/tag merges; v1→v2 migration on a populated database.
- `npx tsc --noEmit`, `npx eslint src`: clean. `npx expo-doctor`: 20/20. `npx expo export --platform android`: Hermes bundle builds.
- Web smoke test (Chrome, 412 px mobile viewport, real expo-sqlite/WASM, fresh database). Accounts: Savings 15,000 and Wallet 800. Expenses: one 158 DH expense tagged #Gym diet with chicken 2 kg = 124 DH and 500 g = 34 DH, plus a 60 DH uncategorised one.
  - Analytics: 218 DH, 8.07 DH/day; chicken 2.5 kg, average 63.20 DH/kg, cheapest 62 DH/kg; tag breakdown 158 + untagged 60; the Uncategorised drill-down lists exactly the 60 DH expense.
  - Goals: Emergency fund 20,000 by Oct 2027. Reserving 16,000 was refused; 10,000 was accepted. My Money then shows 15,582 = 10,000 reserved + 5,582 unallocated.
  - Budget 250 DH with Meat & Fish 150: 87 % used, past the 75 % warning, projected 250.30 DH, Meat & Fish 8 DH over, "everything else" 60/100.
  - Also checked: merchant rename, subcategory creation (inherited "Essential"), and daily trends for Wallet (800 → 582).
- Bugs found and fixed during the smoke test:
  - React Compiler hoisted `category!.id` out of a mutation callback, so the "new category" form crashed. Ids are now passed in mutation inputs and closures capture null-safe locals, in the category, goal and budget forms.
  - The per-merchant price average was a plain mean; it is now weighted like the overall average.
  - The price chart was forced to a zero baseline.
  - Icon-only chips had no accessible name.
  - Per-location trends plotted "0 DH" before the opening date.
- **Still not verified on a physical Android device.**

## Decisions (Phase 2)

- **No `category_groups` table.** Parent categories are the groups (one level of subcategories). This keeps rollups unambiguous and avoids a second grouping that could double count.
- **Budget periods** are weekly (Mon–Sun), monthly (calendar month) or custom dates. The "total" limit is the budget's own `amount_minor`; leaving it empty uses the sum of the category lines. Budgets apply to personal spending in MAD (foreign currencies converted as in the period summary).
- **Budget lines never overlap.** A line covers its category plus those subcategories that have no line of their own.
- **Allocation semantics.** The value set is the reserved total for that goal in that account, not a top-up. Only personal, non-credit, non-archived locations can be reserved. Goals are in MAD; allocations are in the account's currency and converted for progress, and are excluded when no rate exists.
- **Over-allocation** is possible only after explicit consent. Even then, totals and progress count only what the account holds; the rest is shown as "not covered". Lowering an allocation never needs consent.
- **Reservations are not historical.** There is no allocation history yet, so past My Money views and trend points show no reservations instead of guessing.
- **Tag attribution.** A whole-transaction tag wins over item tags on the same transaction. Item-only tags count the tagged lines, capped at the amount paid.
- **Product averages** are weighted (Σ amount ÷ Σ quantity). A plain mean is used only for a merchant whose lines carry a unit price but no quantity. Lines without a unit count towards spending, but no price per unit is shown for them.
- **Insight thresholds.** A category change is reported only if it is at least 15 % and at least 100 DH on one side. Periods compare the same number of days at the start of last month.
- **Analytics stay personal-only**, as in Phase 1. Merchant and product figures use personal expenses.
- **Merges delete the source row** after re-pointing history. There are no tombstones; Phase 4 backup is snapshot-based, not sync.

## Known gaps

- **Not tested on Android hardware.** No JDK/adb on this Mac. On web, `Alert` dialogs (delete and over-allocation confirmations) are no-ops in react-native-web. The service still refuses over-allocation on web, but the "Reserve anyway" path can only be exercised on Android/iOS.
- On web, `CI=1 expo start` does not watch files (restart after edits). Fast full-page reloads can hit expo-sqlite's OPFS lock ("createSyncAccessHandle"); a second reload fixes it. Neither affects Android.
- The custom date range uses the native date picker on Android, and a YYYY-MM-DD text field on web.
- No allocation history: goal progress over time and historical reservations are not shown.
- No "bills" reservations yet (Phase 5 recurring payments). "Unallocated" therefore means "not reserved for goals".
- Insights are computed on demand (no notifications). Budget threshold warnings appear on Home/Analytics only.
- Products have no category/unit editor yet (the default unit is taken from the first purchase).
- Day totals in Activity only add up MAD expenses (unchanged from Phase 1).
- Release builds are still signed with the debug key (needed before Phase 4).

## Next (Phase 3 — company money)

1. Migration v3: company fiscal years, liabilities (IS, TVA, payroll, CNSS, suppliers), reserves, tax assumptions per fiscal year, distribution simulations and distributions (see PLAN.md).
2. SARL dashboard: bank balance vs profit vs distributable profit vs approved vs received distribution, each a separate figure.
3. Company P&L from business expenses/income (the analytics facts can be reused with `ownership = 'business'`).
4. Tax estimates with user-entered, sourced rates per fiscal year; distribution simulator clearly labelled "not yet personal money"; three-totals overview that never sums A + B + C.
5. Consider allocation history (dated reservation events) so goal progress can be charted over time.
