# Progress

Last updated: 2026-10-27

| Phase | Status |
|---|---|
| 1 — Core financial tracking | ✅ Done (see verification below) |
| 2 — Analytics & savings | ✅ Done (branch `phase-2`, see below) |
| 3 — Company money | ✅ Done (branch `phase-3`, see below) |
| 4 — Google Sign-In & Drive backup | ⏳ Next (Google Cloud + OAuth clients ready: [docs/google-oauth.md](docs/google-oauth.md)) |
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

## Phase 3 — delivered

**Data (migration v3, see [PLAN.md](PLAN.md#v3--phase-3-implemented))**
- New tables: company fiscal years, tax assumptions (one typed row per year), tax items (adjustments and other taxes), reserves, obligations with payment links, distribution simulations, distributions with payment links. Companies gain a TVA mode. Nine company system categories. Migrations v1 and v2 are unchanged. The upgrade is tested on a v2 database with personal and company accounts, a salary and a dividend transfer and a goal reservation: every row, balance, period summary and reservation is identical afterwards.

**Services** (all writes in `db.transaction`, every rule tested)
- [company.ts](src/services/company.ts): fiscal years (no overlaps), assumptions, tax items, reserves; the company P&L (`computePnl`, built on the Phase 2 expense facts with `ownership = 'business'` and a company filter); data sufficiency (`dataStatus`); the step-by-step tax estimate (`computeTaxEstimate`); `fiscalYearReport`.
- [obligations.ts](src/services/obligations.ts): obligations; linking real payments (split across obligations, never more than the payment); `payLiability` records the company expense and links it atomically; payment candidates; unlinked tax payments.
- [distributions.ts](src/services/distributions.ts): `simulateDistribution`, saved simulations, `approveDistribution` (also records withholding and other partners' shares as obligations), `payDistribution` (one dividend transfer + link, atomically), `linkDistributionPayment`, `OverDistributionError`, cancellation, consistency checks.
- [overview.ts](src/services/overview.ts): company position (cash, obligations, reserves, liquidity), the SARL dashboard with its checks, the owner payout estimate, the three totals and "what if" scenarios.
- [company-analytics.ts](src/services/company-analytics.ts): P&L breakdowns (reusing `breakdown`/`drillFilter`), month-over-month figures and rule-based company insights.
- `deleteTransaction` now unlinks a deleted payment, which re-opens the obligation or distribution it paid. Transaction filters and drill-down links gained `companyId` and `transferClass`.
- `domain/money.ts`: basis-point helpers (`applyBp`, `parsePercentBp`, `formatBp`, `bpToInput`).

**Screens**
- SARL dashboard (`/company/[id]`): the seven figures as separate rows (cash & bank, outstanding obligations, reserved funds, liquidity after obligations, accounting profit or "Not enough data" with reasons, estimated distributable profit, estimated owner share after withholding), approved-unpaid dividends, "Needs attention" checks, next obligations and shortcuts. Opened from My Money, Home (B card) and Settings.
- Tax estimate: fiscal-year chips, assumptions summary with source, every step with "Recorded / Entered by you / Calculated" and its calculation (and transactions when it has some), what is missing, adjustments and other taxes, and the movements left out of the P&L with their reasons.
- Assumptions and fiscal-year forms; obligations & reserves list; obligation editor; obligation detail (pay from a company account, or link an existing payment; unlink); reserve editor.
- Distribution simulator (inputs prefilled from the year's estimate, the company's ownership and the year's withholding rate; output labelled exactly "Estimated potential personal payout — not yet personal money."; save, reload and delete simulations; record an approval). Approval form, distributions list, and distribution detail (pay via a dividend transfer, link an existing one, unlink, cancel, linked obligations).
- Company analytics: fiscal year or preset periods; revenue, costs, recorded profit; costs/revenue breakdown by category, subcategory, merchant/client, tag and location with drill-down and "Analyse only this"; salary/reimbursement transfers; 12-month columns for profit, revenue or costs with a month list; insights with their calculation.
- Three totals (A personal, B company position, C potential payout) on Home (replacing the company pill when a company exists) and My Money, with "What if…" scenarios and a warning when personal income uses a dividend category.
- Settings: company fiscal-year start month and TVA mode. Transaction detail: which obligation or distribution a payment settles.
- Confirmations in the new screens use `lib/confirm.ts`, which falls back to `window.confirm` on web, so they can be exercised in the web build.

**Verification (2026-10-27)**
- `npm test`: 143 tests in 10 suites (114 before + 29 new). New coverage:
  - Company money never enters personal totals (a full year of company activity; only the salary transfer is personal income).
  - A + B + C never summed (the overview has no total; scenarios move money from B to A without creating any: A + company cash is unchanged).
  - Simulation and approval leave every balance, summary and period summary identical and record no transaction.
  - A distribution paid by a dividend transfer counts once as personal income (no income transaction is created), lowers company cash by the same amount and leaves liquidity unchanged.
  - Obligation payments are not subtracted twice; split payments cannot exceed the payment; only company outflows can pay; deleting a payment re-opens the obligation; unlinked tax payments and overdue obligations are flagged.
  - P&L excludes transfers, owner loans, capital contributions, loan repayments, financing income and IS/TVA payments; salary and reimbursement transfers are costs; internal and other-company movements are ignored.
  - Tax estimate maths with user-entered rates (TVA, adjustments, IS, minimum tax, override, advances, other taxes, legal reserve by rate or recorded, losses brought forward, approved distributions); missing inputs are reported, not guessed; data sufficiency.
  - Over-distribution refused without consent and flagged after it; dividend transfers without approval and unpaid approvals are flagged; only dividend transfers made after the approval can be linked; cancelling removes the approval's obligations.
  - Payout estimate capped by cash after obligations and unrecorded IS; no estimate without data.
  - v2 → v3 migration on a populated database.
- `npx tsc --noEmit`, `npx eslint src`: clean. `npx expo export --platform android`: Hermes bundle builds. `npx expo-doctor`: 20/20 after `npx expo install --fix` (SDK 58 patch updates: expo 58.0.20, expo-router 58.0.27, @expo/ui 58.0.24, expo-web-browser 58.0.7, which also added its config plugin to app.json).
- Web smoke test (Chrome DevTools, 412 px mobile viewport, real expo-sqlite/WASM, fresh database):
  - Personal bank 20,000; SARL "Zenown SARL" bank 100,000; revenue 200,000 (Client A); rent 50,000.
  - Dashboard before assumptions: "Not enough data" with three reasons (location opened today, TVA collected and deductible missing).
  - Assumptions IS 20 %, withholding 12.5 %, TVA 20,000 / 5,000, pre-tracking 0 / 0, adjustment +5,000: revenue HT 180,000, costs HT 45,000, profit 135,000, taxable 140,000, IS 28,000, profit after tax 107,000. Ownership set to 95 %: owner share 88,943.75 net.
  - Obligations: IS advance 7,000 (paid from its screen: cash 243,000, IS still to pay 21,000, profit unchanged) and TVA 15,000 overdue (flagged). Liquidity 228,000.
  - Simulation 40,000 → 38,000 gross, 4,750 withholding, 33,250 net with the exact label; saved. Approval recorded (balances unchanged; withholding and other-partner obligations created). Paying 40,000 asked for confirmation and recorded nothing when dismissed; paying 33,250 moved company bank 243,000 → 209,750 and personal 20,000 → 53,250.
  - Home: A 53,250; B 188,000 (209,750 − 21,750 obligations); C 55,693.75 estimated, 0 approved-unpaid. Income this month 33,250 (once), personal spending 0.
  - Company analytics: revenue 200,000, costs 50,000, 40,250 excluded (IS 7,000 + dividend 33,250); the category drill-down lists exactly the rent.
- Bugs found and fixed during the smoke test: the distribution screen still offered "Pay 0 DH" once fully paid; "starts on Today" wording; figure 7 repeated all the data-status reasons. Approvals now also keep the simulation they came from.
- **Still not verified on a physical Android device.**

## Decisions (Phase 3)

- **Cash-basis P&L from recorded payments.** Invoices and accruals are not tracked; supplier bills can be recorded as obligations. The UI says the accountant's figure may differ.
- **Salary and expense-reimbursement transfers to you are company costs.** They are payroll / reimbursed costs; leaving them out would overstate profit and distributable profit. On the personal side the salary stays personal income (the reimbursement does not). Every other transfer class is excluded from the P&L and listed with its reason.
- **TVA**: a per-company mode — TTC (recorded bank amounts include TVA; default) or HT (no TVA in recorded amounts: exempt, export, not liable). For TTC companies the year's TVA collected and deductible are user-entered from the TVA returns; TVA paid to the state uses its own category and is never a cost. No TVA rate is assumed.
- **NULL vs 0**: every user-entered figure distinguishes "not entered" (NULL) from 0. The estimate lists missing inputs instead of treating them as zero.
- **One IS rate per year** (plus an optional minimum amount and an optional override amount). Bracketed regimes are handled by entering the effective rate or the amount; the note says so.
- **Advances** are payments linked to IS obligations of that fiscal year, plus an "IS paid outside the app" figure. Unlinked IS-category expenses are flagged rather than guessed into a year.
- **Earlier years** count only through "retained earnings brought forward" on the year being estimated, so undistributed profit is never counted in two years. The payout estimate uses the latest fiscal year that has started.
- **Payout estimate (C)** requires complete data, the IS rate and the withholding rate. It is capped by liquidity after obligations minus estimated IS not yet recorded as an obligation. It is shown with its calculation and the note that a running year's profit can only be distributed after the accounts are approved.
- **Approved distributions are company obligations.** The approval records your net share as owed to you and (optionally, on by default) the withholding on your share and the other partners' gross shares as obligations, so B counts the whole distribution once. Paying your share does not change liquidity.
- **Distributions can be paid in several transfers** (`distribution_payments` instead of one `paid_transaction_id`). A transfer can pay one distribution only, and cannot also pay an obligation. A dividend transfer dated before the approval cannot be linked.
- **Over-payment** throws `OverDistributionError`; the UI asks for explicit confirmation and then records it, and the distribution shows the excess in red. Over-paying an obligation is refused outright (the extra is not for that obligation).
- **Obligation payments created from the obligation screen** are company expenses with the kind's category (IS, TVA, CNSS, payroll, withholding, dividends to partners); supplier and other payments are uncategorised P&L costs. An owner's salary obligation is settled by linking the salary transfer.
- **Reserves** never move money: legal/statutory reserves reduce a year's distributable profit; "cash set aside" reduces liquidity. A recorded legal reserve replaces the rate-based one.
- **Estimated IS is shown, not subtracted** from liquidity until it is recorded as an obligation, to avoid counting it twice once it is.
- **Company categories are system categories** visible in every category picker (prefixed "Company:"), because the P&L depends on their ids.
- **Web confirmations**: new screens use `confirmAction`/`notify` (`window.confirm`/`alert` on web) so the lifecycle can be smoke-tested in a browser. Phase 1–2 screens still use `Alert`.

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

- **Not tested on Android hardware.** No JDK/adb on this Mac. On web, `Alert` dialogs in Phase 1–2 screens (delete and over-allocation confirmations) are no-ops in react-native-web; the Phase 3 screens use `lib/confirm.ts` and work on web.
- On web, `CI=1 expo start` does not watch files (restart after edits). Fast full-page reloads can hit expo-sqlite's OPFS lock ("createSyncAccessHandle"); a second reload fixes it. Neither affects Android.
- The custom date range uses the native date picker on Android, and a YYYY-MM-DD text field on web.
- No allocation history: goal progress over time and historical reservations are not shown.
- No "bills" reservations yet (Phase 5 recurring payments). "Unallocated" therefore means "not reserved for goals".
- Insights are computed on demand (no notifications). Budget threshold warnings appear on Home/Analytics only.
- Products have no category/unit editor yet (the default unit is taken from the first purchase).
- Day totals in Activity only add up MAD expenses (unchanged from Phase 1).
- Release builds are still signed with the debug key (needed before Phase 4).
- Company money: no accrual accounting (invoices, receivables, depreciation); the P&L is cash basis. No per-transaction TVA split; TVA is entered per year. No IS bracket tables (one rate, minimum or amount). No company balance-sheet items (capital, assets, owner current-account balance) beyond cash, obligations and reserves.
- The payout estimate (C) uses only the latest fiscal year that has started; profit of earlier years must be entered as retained earnings on that year.
- Company categories appear in the personal expense/income pickers too (under "More"); the entry screens do not yet filter categories by the chosen location's ownership.
- On web, the date fields in the fiscal-year form keep their typed text when another field changes them (the end date does not follow a new start date). Native pickers are unaffected.
- Text inputs have no accessible name beyond their placeholder (pre-existing in `TextField`).

## Next (Phase 4 — Google Sign-In & backup)

1. Google Sign-In (`@react-native-google-signin/google-signin`, development build) and Drive `appDataFolder` backup/restore as in PLAN.md; OAuth clients are already set up ([docs/google-oauth.md](docs/google-oauth.md)).
2. Migration v4: `backups`, `sync_meta`. Snapshot with `VACUUM INTO` (includes the v3 company tables); restore checks `user_version` and runs migrations.
3. CSV/JSON export, including company obligations, distributions and the per-year assumptions with their sources.
4. A release signing key before distributing builds.
5. Carried over: allocation history for goal charts; filtering entry-screen categories by ownership; moving Phase 1–2 confirmations to `lib/confirm.ts`.
