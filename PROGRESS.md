# Progress

Last updated: 2026-10-28

| Phase | Status |
|---|---|
| 1 — Core financial tracking | ✅ Done (see verification below) |
| 2 — Analytics & savings | ✅ Done (branch `phase-2`, see below) |
| 3 — Company money | ✅ Done (branch `phase-3`, see below) |
| 4 — Google Sign-In & Drive backup | ✅ Done (branch `phase-4`); Android device check pending, see the checklist below |
| 5 — Recurring, debts, attachments, polish | 🔶 Parts 1–2 done (branch `phase-5`): recurring bills, expected income, debts & receivables, simple company estimate, faster expense entry, app icon; receipt photos (schema v6, in backups) and on-device receipt scanning, which now fills the whole expense (items, discounts, the amount actually paid). Next: real ML Kit receipts from the S22 into the corpus, Android check, notifications |

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

## Phase 5 — part 2c delivered: estimated prices for items without a price

Rules in [PLAN.md](PLAN.md#estimated-item-prices-phase-5-rules). Offline, no AI or API.

**What it does**
- Expense form, items: when some items have no price, the summary offers **Estimate N prices** ("Split 54 DH across the items without a price, by what each usually costs"). Each estimated line shows "≈ 23 DH" and where its usual price came from; typing a total makes it real. If the amount changes, **Estimate again**. An unpriced line shows its usual cost as a hint ("Usually ≈ 33 DH (22 DH/kg, starter price list)").
- Transaction detail: estimated lines show "≈" and "estimated".
- **Usual prices** screen ([products/prices.tsx](src/app/products/prices.tsx), from Products & prices): the starter list by group, with your purchases' and your own price next to it; search by French, Darija or English name; tap to set or remove your price; add a price for anything else.

**Code**
- [domain/price-book.ts](src/domain/price-book.ts): starter list (≈100 items: vegetables, fruit, meat, fish, dairy, bread/grains, groceries, drinks, household), Casablanca/Rabat retail, October 2026. Prices are rough starting points written from general knowledge, not a survey: they should be checked against real receipts and corrected (mostly the ratios matter, since the amount paid is real).
- [domain/price-estimate.ts](src/domain/price-estimate.ts): name matching, usual cost of a line, exact split.
- [services/prices.ts](src/services/prices.ts): learned prices, your list (CRUD), the merged price book.
- Migration **v7**: `purchase_items.estimated` (default 0) and `price_refs` (with change triggers). The ledger writes `estimated` only when set, so older schemas built in tests still take items.
- `loadProductLines` and `suggestProducts` ignore estimated lines' quantity/price.

**Tests** (+25, 311 total): starter list sanity; names (accents, plurals, sizes, Darija); source priority and recency; usual cost (units, bare numbers, size in name, incompatible units, per purchase); `allocate` always exact; estimates with discounts/charges/unallocated/re-estimate; learned prices (last 3, unit groups, never from estimates); your list (one per name, tracked for backups); price book joins; saved estimates never reach price history/suggestions; ledger refuses estimates that don't add up; v6 → v7 migration changes nothing else.

**Checks**: `npx tsc --noEmit`, `npx eslint src`, `npm test` clean. Web smoke test (Playwright, 412 px, existing test profile DB migrated to v7): Usual prices lists the starter list; "matecha" finds Tomatoes, already learned at 10 DH/kg from an earlier purchase; set my price 12 DH/kg. Expense 60 DH: Tomates 2 kg, Poulet, Pain 6 → hints shown → Estimate → ≈ 23 / ≈ 31 / 6 = 60. Amount changed to 70: Save refused with the "Estimate again" message; re-estimated and saved; detail shows ≈ 27 / ≈ 37 / 6. No console errors.

## Phase 5 — part 2b delivered: receipt scanning fills the whole expense

No schema change (still v6), no new dependency, no change to the OCR modules.

**What the parser now reads** ([domain/receipt-parse.ts](src/domain/receipt-parse.ts), rules in [PLAN.md](PLAN.md#receipt-photos-and-scanning-phase-5-rules))
- **Two amounts**: `totalMinor` (TOTAL, TOTAL TTC…) and `finalMinor` (NET A PAYER, A PAYER, MONTANT TTC, TOTAL NET), plus `receiptAmount()`, which returns the amount paid when printed and the total otherwise. Global REMISE, ARRONDI (either sign), TIMBRE and SERVICE lines between the two must explain the difference. Without NET A PAYER, a card or cash amount equal to "total − the discounts printed after it" becomes the amount (medium confidence).
- **Cross-checks** (agreement raises confidence; a disagreement lowers it and the warning names the pair): lines vs total, total vs amount paid, cash − change or card vs amount paid.
- **Items**: no longer all-or-nothing.
  - Every line read is proposed with its own `confidence`, `source` and matched `productId`/`categoryId`. The part of the amount no line was read for becomes one `unallocated` line, "Not read from the receipt" (`unreadMinor`), so the lines always add up to the amount and nothing is counted twice.
  - Lines adding up to more than the amount → no items, with a warning.
  - Layouts: see PLAN. Real Marjane receipts print a department subtotal after each line (BISCUITERIE 9.90, MENAGE 139.00); these are now skipped instead of counted twice. "Dont droits de timbre" (read as "NONT") becomes a 0.37 charge line.
- **Item names**: codes (incl. "(5)6221134002638"), VAT rates, tax letters and "x1" are dropped; names are title-cased (accented capitals too) and keep their sizes.
- **Products**: matched like merchants (accent/case-insensitive, one OCR slip, only when unambiguous) and renamed to the existing product, so the ledger reuses it. [queries.ts](src/services/queries.ts) `listProductNames` gives each product its usual category: its own, otherwise the most common category of its live expenses.
- **Dates**: a time after the date, "DATE:", "Le", French/English month names, O→0 and l→1 slips inside digit groups, and dates glued to a ticket number or a time (the last two are one level less sure).
- **Ledger rule checked, not changed**: items are a breakdown and never change the paid amount (`saveExpense` stores them as given; item tags are capped at the amount paid). There is no "items must equal amount" rule in the ledger; the parser's unallocated line makes the proposal add up. `purchase_items.category_id` is still never written: the form has no per-line category, so a product's category is used for the expense category only.

**Form** ([entry/expense.tsx](src/app/entry/expense.tsx))
- Amount ← amount paid (else the total); date; merchant (an existing merchant is reused by id); items, including the unallocated line; category ← the merchant's default, otherwise the matched products' most common category (only if usable from the chosen location); note stays empty.
- The "From receipt" banner adds "N items read, X DH not matched to a line". Each item card shows its own "check this" (amber when low); editing a line clears its hint.
- Nothing is saved until Save; leaving still deletes the temporary photo and the draft.

**Corpus and OCR export**
- [src/domain/__fixtures__/receipts](src/domain/__fixtures__/receipts): `marjane-vision` and `bim-vision` (the two Apple Vision readings that were inline in the test) moved there with `.expected.json` files (total, final, amount, date, merchant, unread, every item). [receipt-fixtures.test.ts](src/domain/receipt-fixtures.test.ts) runs every fixture. A fixture without an expected file fails and prints the parser's reading in the expected format, ready to correct against the paper.
- **Exporting OCR from the phone**:
  1. Settings → Developer → turn on "Share OCR data from scans". It is always on in a dev build.
  2. Scan a receipt. In the "From receipt" banner, tap **Share OCR data**. This shares JSON (image size, then one line per OCR line, with box and confidence) to Drive, Gmail, Keep, etc.
  3. Save it as `src/domain/__fixtures__/receipts/<store>-<kind>.json`, run `npm test -- receipt-fixtures`, copy the printed reading to `<store>-<kind>.expected.json`, and correct it against the paper.

  The OCR text stays in the in-memory draft and is never written to the database or a file by the app.

**Verification (2026-10-28)**
- `npm test`: 286 tests in 20 suites (255 before + 31 new):
  - Parser (26 more in `receipt-parse.test.ts`; the two real receipts moved to the corpus): two amounts (global discount, rounding, stamp duty, service, "dont timbre" inside or outside the lines, total vs amount-paid mismatch with and without adjustments, card-derived amount, cash − change mismatch, NET A PAYER alone).
  - Item layouts: name / qty×price / amount rows; quantity row after (with and without the amount); EANs before/after; weights on and below the name; QTE/PU columns in both orders and disagreeing; per-item vs named discounts; VAT letters/rates; wrapped names; header rows never joined; department subtotals; fuel with disagreeing volume × price; per-line weak OCR.
  - Names, products (exact, accents, OCR slip, ambiguous) and dates (time, label, "Le", month names, slips, glued, still never swapped).
  - Changed on purpose: items short of the total now come with an unallocated line; items over the total give none (was: within tolerance); a total confirmed by its lines is "high"; fuel has its item; "27/1O/2026" is now read as a date.
  - Corpus (4: non-empty, 2 fixtures, export round-trip); `listProductNames` (1).
- `npx tsc --noEmit`, `npx eslint src`: clean.
- Web smoke test (headless Chromium, 412 px, fresh database; web OCR stubbed for the run and reverted): a receipt with Lait 2 × 7.50, Pain 3.00, TOTAL 25.00, REMISE −1.00, NET A PAYER 24.00. The form showed amount 24, Marjane, today's date, the line hints (amber on "Not read from the receipt"), "2 items read, 7 DH not matched to a line" and the warning naming the lines vs the total. "Share OCR data" was shown. Save stored one 24 DH expense with 4 lines. No console errors.
- **Not verified on Android**: every corpus receipt so far is an Apple Vision reading made on the Mac. ML Kit on the S22 splits lines and gives confidence differently, so the first S22 exports matter most.

### Fixture status

| Fixture | Total | Paid | Date | Merchant | Items |
|---|---|---|---|---|---|
| marjane-vision | ✅ 149.27 | (none printed) | ✅ 21/05/2017 | ✅ | ✅ 3 lines (Chocolat Galaxy 2 × 4.95, Friteuse 139.00, stamp duty 0.37), nothing unread |
| bim-vision | ✅ 42.80 | (none printed) | ✅ 15/11/2024 | ✅ | ✅ 2 lines, nothing unread |

### S22 checklist for this part (preview build with the change)

1. Settings → Developer → "Share OCR data from scans" on.
2. Scan, and for each receipt tap **Share OCR data** before saving. Send the exports with a photo of the paper. Wanted: a supermarket (Marjane/Carrefour/BIM, long), a café, a pharmacy (NET A PAYER), a fuel station, a TVA invoice (HT/TVA/TTC), one paid in cash (ESPECES/RENDU), one with a REMISE or ARRONDI, and a crumpled/blurry one.
3. On each: is the amount what left the account? Is every printed line there, with quantity/unit price where printed? Is "Not read from the receipt" the right difference? Are the amber lines the doubtful ones? Note anything wrong.
4. Scan a receipt with a product bought before (same name): the line uses the existing product name, and the category is the one used last time for it (when the store has no default).
5. Edit a prefilled line: its "check this" disappears. Save: the expense's items add up to the amount (detail screen).
6. Leave the form without saving: nothing saved, photo deleted.

## Phase 5 — part 2 delivered: receipt photos and scanning

**Data (migration v6, see [PLAN.md](PLAN.md#v6--phase-5-part-2-implemented))**
- `attachments` (transaction → CASCADE, path relative to the documents directory, mime, SHA-256, size) with change triggers. Migrations v1–v5 are unchanged; v5 → v6 on a populated database changes no other row.

**OCR (decision: a local Expo module)**
- [modules/receipt-ocr](modules/receipt-ocr): our own small Expo module, autolinked from `modules/`. Android: Google ML Kit text recognition **bundled** Latin model (`com.google.mlkit:text-recognition:16.0.1`, works offline from the first launch, about +4 MB per CPU architecture). iOS: Apple Vision (`VNRecognizeTextRequest`, accurate, fr-FR/en-US, no language correction). Returns lines with bounding boxes and confidence. Free, MIT-compatible, nothing leaves the phone; no cloud OCR or LLM.
- Compared and not chosen: `expo-text-extractor` (flat strings, no boxes/confidence, Play-services model that must be downloaded first), `expo-ocr-kit` (blocks only on Android, leftover template WebView, single maintainer), `expo-mlkit-ocr` (ML Kit on iOS instead of Vision), `@infinitered/react-native-mlkit-text-recognition` (ML Kit on both, two packages, last release Nov 2025).
- **Arabic is not supported**: ML Kit v2 reads Latin, Chinese, Devanagari, Japanese and Korean only. French/Latin receipts are read; Arabic text is ignored.
- [lib/receipt-ocr.ts](src/lib/receipt-ocr.ts) uses `requireOptionalNativeModule`, so an older build without the module still opens the scan flow (photo attached to an empty form). Web: no OCR.

**Services and domain**
- [domain/receipt-parse.ts](src/domain/receipt-parse.ts): joins OCR lines into rows using their boxes, then proposes total, date, merchant and items, each with a confidence and its source text, plus warnings. Rules in [PLAN.md](PLAN.md#receipt-photos-and-scanning-phase-5-rules); amounts only via `parseAmount`.
- [services/attachments.ts](src/services/attachments.ts): `AttachmentStore` port; `saveExpenseWithAttachments` (write file → read back and check SHA-256 → expense + rows in one transaction → remove new files on any failure; removed photos' files deleted after the commit), `removeAttachment`, `deleteTransactionWithFiles`, `findDuplicates` (same SHA-256, or same amount + date + merchant). `saveExpense` takes `attachments` / `removeAttachmentIds`; `deleteTransaction` removes photo rows and returns their paths.
- [services/backup.ts](src/services/backup.ts): photos uploaded once per content, before the database, each verified by download; manifest `attachments` count/size; restore checks or downloads and verifies every photo before the swap and stops unless "restore without them" is chosen; `verifyRemoteBackup` reports photos present on Drive. Drive uploads take a MIME type.
- [services/export.ts](src/services/export.ts): JSON entries list their photos (file, type, SHA-256, size). CSV unchanged.

**App**
- Add sheet → **Scan receipt** → camera opens (on web: Take photo / Choose from gallery) → "Reading receipt…" → the expense form with a **From receipt** banner (thumbnail, warnings), "Read from the receipt: check this" under the amount, merchant, date and items (amber "not sure" when confidence is low). A known merchant brings its usual category and last location, as when it is picked by hand. Items only when they add up.
- Expense form (new and edit): **Receipt photo** section to take/choose/remove photos; removed photos are deleted on Save. Save stores the expense and photos together; leaving the form deletes the temporary photo. Duplicate guard before saving (`lib/confirm`). Validation messages now use `lib/confirm` (they work on web).
- Transaction detail: receipt photos (tap → full-screen viewer `/attachments/[id]`); deleting says the photos go too (now via `lib/confirm`).
- Backups & restore: photo count per backup, photos checked by "Check integrity", "Some receipt photos are missing → Restore without them", photos in the backup/restore messages; the file-restore note says photos are not inside `.db` files.
- Config: `expo-image-picker` (camera/photo permission texts, microphone off) and `expo-image-manipulator` via `npx expo install`. **A new development/preview build is required** (new native code: ML Kit, image picker).

**Verification (2026-10-27)**
- `npm test`: 249 tests in 19 suites (211 before + 38 new):
  - Parser (22): amounts (comma decimals, thousands, DH/MAD, 3-decimal prices, dates/codes not amounts); rows joined from boxes; supermarket (Marjane: TOTAL TTC confirmed by cash − change, items incl. a 2 × 7,50 row and 1,250 kg × 62,00, a discount), Carrefour with boxes and a CB line, pharmacy (NET A PAYER), café (leading counts, dd-mm-yy), fuel station (MONTANT + CB; volume/price not items), TVA invoice (HT/TVA ignored), cash and change (no total invented from them), card amount disagreeing, conflicting totals, label on the previous row, weak OCR, a blurry/partial receipt (nothing extracted), no text, future and too-old dates, no month/day swap, phone numbers, items not adding up, tolerance, inconsistent qty × price; existing merchants reused (accents, partial name, OCR slip).
  - Attachments (16): save with photo (row, file, SHA-256, balance unchanged); a ledger refusal or a failed file write leaves no file and no row; edit keeps/adds/removes photos and deletes removed files; a photo of another expense cannot be removed; deleting a transaction removes its photos; change triggers and change counter; non-photo files and unsafe paths refused; duplicates (same image, same amount/date/merchant, excluded self and deleted); backup uploads photos once and verified, manifest counts, photo files not listed as backups, integrity check reports them; a damaged photo upload records no backup; photos missing on the phone are counted; restore on a new phone downloads and verifies every photo (data identical); a damaged photo stops the restore with nothing changed (and no stray files) unless restoring without it; `.db` restore uses local photos; JSON export lists photos; v5 → v6 migration on a populated database.
- `npx tsc --noEmit`, `npx eslint src`: clean. `npx expo-doctor`: 20/20. `npx expo export --platform android`: Hermes bundle builds. `npx expo-modules-autolinking resolve --platform android` lists `expo.modules.receiptocr.ReceiptOcrModule`.
- Web smoke test (headless Chromium, 412 px, real expo-sqlite/WASM, OPFS for photos, fresh database; the browser MCP servers were unavailable, so a Playwright script was used): Add sheet shows "Scan receipt"; the scan screen explains that reading works on Android; choosing a picture opens the expense form with the "From receipt" banner and the photo; saving 245.90 DH at Carrefour stored one photo file and Wallet 800 → 554.10; detail shows the photo, tap opens the full-screen viewer; scanning the same picture again with the same amount/merchant showed "Already recorded?" with both reasons and saved nothing when dismissed; editing to remove the photo and add another left exactly one (new) file; deleting the expense ("Its receipt photo is deleted too") removed the file. With OCR stubbed on web (not committed), a Marjane receipt prefilled 27 DH, Marjane, 25 Oct and two items with "check this" hints; saving was refused because the receipt date was before the Wallet's opening date (correct ledger rule).
- **Not yet verified on Android**: camera, gallery, ML Kit reading, photo storage and Drive photo backup. See the checklist below.

**Fix after the first S22 test (2026-10-27)**
- Symptom: every scan said "The photo could not be read: Attempt to invoke virtual method 'java.lang.Class java.lang.Object.getClass()' on a null object reference" (preview APK). Not the photo and not OCR quality: ML Kit failed before reading.
- Cause: release builds are minified (`android.enableMinifyInReleaseBuilds=true` in the SDK 58 template, AGP 9.2.1). R8 on AGP 9 no longer keeps the no-arg constructor for `-keep class` rules, and firebase-components only ships `-keep class * implements ComponentRegistrar`. ML Kit creates its registrars by reflection, so none were registered, `MlKitContext.get(SharedPrefManager)` returned null and ML Kit's logger null-checked it (`getClass()`). Debug/dev-client builds are not minified, so they would not show it.
- Fix: [modules/receipt-ocr/android/proguard-rules.pro](modules/receipt-ocr/android/proguard-rules.pro) as `consumerProguardFiles` (keeps `ComponentRegistrar` constructors; applied to the app, no change to CNG or app config). Checked with a local `:app:minifyReleaseWithR8` (prebuild in a scratch copy): with the rule, `CommonComponentRegistrar.<init>` and `TextRegistrar.<init>` are in `mapping.txt`; without it R8 removes them (`TextRegistrar.<init>()` listed in `usage.txt`, no `<init>` left for `CommonComponentRegistrar`).
- Parser, from two real receipts (Marjane, BIM; lines and boxes from Apple Vision on the Mac with the module's settings, kept as test fixtures): "T O T A L" read as "TOTA L" is now a total label (spaced letters joined for labels only, never for exclusions); its large amount printed lower is taken from the next row when its box starts within the label row; "TOTAL TTC dont TVA" is a total (the larger amount); rows with 3+ amounts (TVA tables) are not totals; the VAT rate column ("20%") is dropped from item names. Marjane → 149.27 (was 148.90 from the TVA table), BIM → 42.80 with both items (was no total). 255 tests.

### Android checks for receipts (S22, preview build)

1. **Scan**: + → Scan receipt → the camera opens (allow the permission) → photograph a real supermarket receipt → "Reading receipt…" → the form shows the total, store, date (marked "check this") and items only if they add up. Check each field against the paper, Save → the expense appears once; the photo shows on its detail screen and opens full screen.
2. **Gallery**: Scan receipt → back out of the camera → Choose from gallery → a receipt photo → same as above.
3. **Hard cases**: a café ticket, a pharmacy receipt (NET A PAYER), a fuel receipt (MONTANT, CB), a receipt with TVA lines, one with ESPECES/RENDU, a crumpled or blurry one (fields left empty rather than wrong), a receipt partly in Arabic (Arabic is ignored). Note which fields were wrong and send the OCR text if possible.
4. **Offline**: airplane mode, scan again: reading still works.
5. **Duplicates**: scan the same receipt again → "Already recorded?" → Cancel saves nothing.
6. **Cancel**: scan, then go back without saving → nothing saved (temporary photo deleted).
7. **Manual photo**: a typed expense → Take photo → Save; edit it → remove the photo → Save; delete an expense with a photo.
8. **Permissions**: deny the camera once → the message suggests the gallery; then allow it in Settings.
9. **Backup**: Back up now → "N receipt photos uploaded and verified"; Backups & restore shows the photo count; Check integrity → "all N receipt photos are on Drive". Reinstall → Restore → photos come back (detail screen shows them).
10. **Size**: note the APK size compared with the previous preview build (ML Kit adds about 4 MB per CPU architecture).

## Phase 5 — part 1 delivered

**Data (migration v5, see [PLAN.md](PLAN.md#v5--phase-5-implemented))**
- `transactions` rebuilt so its kind CHECK allows `debt` (loan principal). The migration copies every row in order, recreates indexes and change triggers from their stored SQL, runs with foreign keys off (so the drop cannot cascade to postings) and refuses to commit unless `foreign_key_check` is empty. Migrations can now declare `rebuildsTables`.
- New tables with change triggers: `debts`, `debt_payments`, `recurring_rules`, `expected_payments`. `companies` gains `payout_mode` and `simple_payout_bp`. New system category "Loan interest".

**Services**
- [recurring.ts](src/services/recurring.ts): rules (monthly, quarterly, yearly, custom every N days/weeks/months/years, end date, reminder window, pause), one-off expected payments, occurrences computed from the schedule (only paid/skipped/adjusted ones are stored), pay (records the expense, income or loan repayment and links it atomically), link an existing transaction, skip, reopen, adjust one date's amount, link candidates, bill reservations per location, expected income. Schedule maths in [domain/schedule.ts](src/domain/schedule.ts).
- [debts.ts](src/services/debts.ts): debts I owe and money owed to me, with or without a starting money movement, repayments (principal + optional interest), link an existing expense/income/repayment, unlink, close/reopen, outstanding as of any date.
- [ledger.ts](src/services/ledger.ts): `saveDebtMovement` (principal in/out on a personal non-card location; interest as a linked "Loan interest" expense). Deleting a transaction also re-opens the debt or bill it paid.
- [balances.ts](src/services/balances.ts): My Money adds reserved for bills (after goals, capped by the balance, shortfall reported), debt liabilities, receivables (apart), expected income (projection). `reserved` is now goals + bills; `reservedGoals`/`reservedBills` split it.
- [overview.ts](src/services/overview.ts): simple payout mode (an entered net share of company money; approved-unpaid dividends inside it, never added twice).
- [export.ts](src/services/export.ts): loan principal in/out as its own totals (never income, spending or transfers); JSON lists debts with repayments and recurring payments.
- [queries.ts](src/services/queries.ts): merchant suggestions carry where and how much was paid there last time.

**App**
- **Bills & expected** (My Money → Bills, Settings): reserved total, shortfall and overdue banners, bills due in 30 days, expected income, recurring list; rule detail (overdue, coming up, history, pause); form for recurring or one-off payments (bill / expected income, location, category or debt, payee, frequency presets or custom, next due date, end date, reminder, reserve); occurrence screen (record paid/received with actual amount and date, interest for installments, link a recorded transaction, adjust this date, skip, undo).
- **Debts & money owed** (My Money → Debts, Settings): I owe / owed to me totals, lists, settled; form (direction, person, amount, "I received / gave this money" with location, dates, notes); detail (outstanding, repayments with unlink, record a repayment with interest, link a recorded transaction, close/reopen, plan installments).
- My Money tiles: liabilities split cards/debts, owed to me, reserved for goals, reserved for bills, expected income; the total = goals + bills + unallocated line. Home: "Bills needing attention" (overdue and inside the reminder window) or "Coming up". Goals tab uses the goals-only reservation. Activity: "Loans" filter; loan movements show as "loan, not income or spending"; transaction detail links to its debt or bill and shows interest.
- **Company → simple estimate** (Settings → company): "Detailed (accounting)" or "Simple (a % of company money)" with your net share; dashboard figure 7 and the C card explain the calculation.
- **Expense entry**: Where → Paid from → Category → Date → Tags (always visible) → items/note. "Recent" places before typing, matches while typing; picking one fills its category, the location last used there (unless chosen by hand) and offers "Same as last time: X". Categories: most-used first, then "All categories" with search (accent-insensitive) and groups (your parent categories, then display-only themes for the built-in ones). Company categories only appear for company locations (also on income). Income uses the same order and history.
- New app icon (wallet and coin on the app green) for Android adaptive (foreground, background, monochrome), the store icon, splash and favicon. The iOS icon now uses the same image.

**Verification (2026-10-27)**
- `npm test`: 211 tests in 17 suites (176 before + 35 new). New coverage:
  - Schedules: month-end, 29 February, quarterly, weekly, daily, end dates; scanning from a late date equals a full scan.
  - Bills: expected payments never change a balance; reserved within 30 days only; paying at the expected amount leaves available unchanged; paid once; deleting the payment re-opens it; reserved after goals and capped (shortfall); overdue, skip, reopen; link one transaction to one bill only; schedule change keeps history; pause; credit-card bills not reserved; personal only; category kind; location in use cannot be deleted; one-offs.
  - Expected income: never in liquid/available/income until received.
  - Loan installments: repayment + interest, net position falls by the interest only; debt direction and currency must match.
  - Debts: borrowing leaves net position, income and spending unchanged; repayments with interest; over-repayment refused; closed debts; "they paid for me" repaid by an expense counts the purchase once; one debt per transaction; the starting movement cannot repay; editing rewrites the movement; deleting the movement or the debt; personal only; receivables never counted as cash; history as of a date; export totals.
  - Simple payout: 28 % of company money without any fiscal-year data; an approved dividend is inside the share; paying it lowers the share; personal money unchanged; switching back keeps the setting.
  - v4 → v5 migration on a populated database: every row identical and in order (incl. a soft-deleted transaction and a fee), indexes and triggers identical, foreign keys intact and enforced, one change-counter bump (the new category). A v3 backup restores through v4 and v5.
  - Merchant suggestions (recent, matching, last location and amount); company categories only for company locations.
- `npx tsc --noEmit`, `npx eslint src`: clean. `npx expo-doctor`: 20/20. `npx expo export --platform android`: builds.
- Web smoke test (Chrome, 412 px, fresh database): created a monthly internet bill (300 DH reserved), paid it (balance 9,700), borrowed 5,000 from Brother into CIH (liabilities 5,000, net unchanged), repaid 1,000 + 50 interest (13,650; 4,000 outstanding; spending today 350, loans excluded), My Money net after debts 9,650, company simple mode at 28 % of 100,000 → C 28,000; expense form order, recent places, "same as last time", category search and groups. No console errors. Fixed during the test: loan interest missing on the repayment detail and "transfer fee" wording on delete, "on Today" wording, bill payments with no category showing as "Expense".

## Phase 4 — delivered

**Data (migration v4, see [PLAN.md](PLAN.md#v4--phase-4-implemented))**
- `sync_meta` (stable device id, change counter, the backup the data last matched, last backup/restore, recovery copy, retention) and `backups` (log of verified uploads). Change triggers on every user-data table bump the counter, so the app knows whether anything changed since the last backup. Migrations v1–v3 are unchanged; the upgrade is tested on a v3 database with company obligations, a paid TVA obligation, an approved and partly paid distribution, a goal, a budget and tags.
- `Db` gained `exclusive(fn)`: holds the write queue outside a transaction (checkpoint, `VACUUM INTO`, restore).

**Services** (pure logic and every rule tested with node:sqlite; native work behind ports)
- [backup.ts](src/services/backup.ts): WAL-safe snapshot (`wal_checkpoint(TRUNCATE)` + `VACUUM INTO`), manifest with SHA-256 and row counts, Drive metadata encoding, inspection (`integrity_check`, schema, core tables, foreign keys), backup to Drive with download-and-verify before recording, retention, verified restore with recovery copy and automatic roll-back, undo restore, divergence checks. Ports: `BackupEngine` (snapshot file, in-memory copies, live swap, recovery copy) and `DriveStore`.
- [drive-api.ts](src/services/drive-api.ts): Drive v3 REST for `appDataFolder` (list with paging, multipart upload with size check, download, delete); one token refresh on 401; clear errors for offline, auth, permission, quota and missing files. `fetch` and tokens are injected.
- [export.ts](src/services/export.ts): CSV and JSON by date range, scope and categories; one row per effect on a money location, side + company on every row, per-side per-currency totals, company fiscal years with assumption sources, obligations and distributions.
- `domain/money.ts`: `formatDecimal` (machine-readable amounts). `domain/dates.ts`: `formatTimestamp`.

**App**
- [lib/backup-engine.ts](src/lib/backup-engine.ts): the engine on expo-sqlite (`VACUUM INTO` → open + `serializeAsync`; `deserializeDatabaseAsync`; `backupDatabaseAsync` into the open connection; `money-tracker-recovery.db`). Works on Android and in the web build.
- [lib/google-auth.ts](src/lib/google-auth.ts) (+ `.web.ts` stub): configure with the web client ID and `drive.appdata`, silent session restore, sign in (cancel returns quietly; missing Drive scope is requested), sign out, token source. [lib/google-errors.ts](src/lib/google-errors.ts): messages for DEVELOPER_ERROR (10), network (7), Play services, expired session.
- [lib/files.ts](src/lib/files.ts) (+ `.web.ts`): share via the system share sheet (expo-file-system + expo-sharing), pick a file (`File.pickFileAsync`); downloads / file input on web.
- Settings → **Backup & export** replaces the placeholder: "Backup, not sync" note, Google account (Android-only notice on web), last backup / unsaved changes, Back up now, links.
- **Backups & restore** screen: Drive history (date, device, "this phone", size, data version, app version, counts, "matches this phone"), Check integrity (download + SHA-256 + SQLite checks), Restore, Delete; keep last 3/5/10/20; Restore from a file; recovery copy with Undo restore.
- **Export data** screen: period presets or custom dates, personal / company / both, all or selected categories (+ uncategorised), CSV or JSON, live per-side totals, and "Save a full backup file (.db)".
- Confirmations use `lib/confirm.ts`; new `chooseAction` for the explicit restore choice (back up first / replace).
- Config: `@react-native-google-signin/google-signin` 16.1.5 (config plugin without options: Android needs no Firebase file), `expo-file-system`, `expo-sharing`, `expo-dev-client`; eas.json `development` profile (development client, internal APK). Package `dev.moneytracker.app` and the EAS keystore are unchanged.

**Verification (2026-10-27)**
- `npm test`: 176 tests in 13 suites (143 before + 33 new). New coverage:
  - Snapshot of a file-backed WAL database with a write still only in the `-wal` file: a raw copy of the database file misses it, the snapshot has it, every table (incl. the v3 company tables) and identical rows.
  - Manifest: size, SHA-256, schema, device, change counter, row counts; Drive metadata round-trip within 124 bytes per property.
  - Rejected and harmless: flipped byte (hash), truncated file (size), not SQLite, damaged SQLite, a SQLite file that is not Money Tracker, newer schema. The phone's data is byte-identical afterwards.
  - A v3 backup restores and migrates to v4 (balances and summaries identical), the device keeps its id.
  - Restore from Drive replaces everything, keeps the device's metadata, leaves no unsaved changes; the recovery copy equals the previous data; undo puts back every row exactly (and is itself undoable); a damaged recovery copy is refused.
  - Upload verification: a corrupted download discards the upload, records nothing, deletes nothing. Retention keeps N, never the only/newest/verified backup or another device's; failed clean-up does not fail the backup.
  - Divergence: local changes after a backup, another device, older backup, fresh install, newer backup from another device before backing up.
  - Every user-data table has change triggers; reads and UI preferences do not count as changes.
  - Export: decimals from minor units, CSV quoting and formula safety, date range, categories with subcategories, uncategorised, scope; salary transfer as one row per side; personal totals exclude company money and match the real change in personal money.
  - Drive client: paging, multipart body bytes, upload size check, token refresh, offline/auth/404/quota/permission errors. Sign-in error messages.
  - v3 → v4 migration on a populated database (incl. obligations and distributions).
- `npx tsc --noEmit`, `npx eslint src`: clean. `npx expo-doctor`: 20/20. `npx expo export --platform android`: Hermes bundle builds.
- Web smoke test (Playwright, 412 px viewport, real expo-sqlite/WASM, the Phase 3 smoke-test database, which migrated to v4 on open):
  - Settings shows "Backup & export" with the "Backup, not sync" note, the Android-only Google account state and "This phone has changes that are not in any backup".
  - Export: CSV of this year = 4 rows (expense −100, salary +8,000 personal and −8,000 Zenown SARL, adjustment −50); JSON totals personal net +7,850 (incl. income from company 8,000) and company −8,000, never added.
  - Full backup file (.db): `VACUUM INTO` works on web; the file has schema v4, `integrity_check` ok, all 81 triggers.
  - Restore from file of a copy with an extra "Restored marker" location (1,234 DH): the explicit-choice prompt appeared (unsaved changes); after replacing, My Money showed 49,884 DH with the marker without reloading; Undo restore brought back 48,650 DH without it. A CSV picked as a backup is refused before anything changes.
  - Fixed during the smoke test: the export summary left out balance adjustments (in/out did not add up to net); long list subtitles were cut to one line; a non-database file was only rejected after the "replace your data?" prompt; "last restore" after an undo repeated the recovery label.
- **Not yet verified on Android**: Google sign-in, Drive upload/list/download/delete, share sheet, file picker. See the checklist below.

### Android checks after an EAS development build

Build: `npx eas-cli@latest build --profile development --platform android` (or `preview` for a standalone APK). Then on the S22:
1. **Sign in**: Settings → Backup & export → Sign in → pick the test Google account → consent. Expect your email and "private app folder on Google Drive". Also try: cancel the picker (no error), airplane mode (network message), sign out / sign in again, and close and reopen the app (still signed in).
2. **Back up**: add a few transactions incl. a company one → Back up now → "Backup complete … SHA-256 matches". Backups & restore lists it as "this phone", with counts; "Matches this phone"; Check integrity → ✓.
3. **Change detection**: add an expense → Settings says "changes that are not in any backup". Back up twice more with "Keep last 3", then a fourth time: the oldest one disappears.
4. **Export**: Export data → CSV and JSON → the share sheet opens; save to Files/Drive and open the CSV in Sheets (accents, negative amounts, side/company columns). Save a full backup file (.db).
5. **Reinstall and restore**: write down My Money and the company dashboard figures → uninstall → install the same APK → Sign in → Backups & restore → the backup shows another device id → Restore (no unsaved-changes prompt on an empty install) → My Money, location balances, company dashboard, obligations and distributions match. Undo restore → empty again → restore again.
6. **Divergence**: after restoring, add an expense, then Restore an older backup → the explicit choice appears (Back up this phone first / Replace).
7. **Restore from a file**: Backups & restore → Restore from a file → pick the saved .db.
8. If sign-in says DEVELOPER_ERROR: the APK is not signed with the EAS key (SHA-1 in [docs/google-oauth.md](docs/google-oauth.md)).

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

## Decisions (Phase 5)

- **OCR is our own local Expo module** (bundled ML Kit on Android, Vision on iOS) rather than a third-party package: none of the candidates returned lines with boxes and confidence from Vision + bundled ML Kit, and ~150 lines of native code we own carry no maintenance risk across SDK upgrades. Bundled (not Play-services) so it works offline from the first launch.
- **The parser proposes, the user decides.** Only labelled totals are used; payment lines only confirm. A missing field stays empty; the date falls back to today, flagged. Items are proposed only when they add up.
- **Photos are files, not database blobs**, so the database (and its snapshots) stays small; their SHA-256 and size are in the database, so the backup's hash covers them. On Drive they are stored once per content and never deleted automatically (an older backup may still need them).
- **Local photo files are named by attachment id** (`attachments/<id>.jpg`). Rows never change, so the same id always means the same content; a restore only fetches what is missing or damaged.
- **Missing photos never block money data silently**: the restore stops and asks; restoring without them is an explicit choice.
- **The draft travels in memory** (`lib/receipt-drafts`), keyed by an id in the route; OCR text is not stored.
- **Photos only on expenses** for now (the scan flow and the form); income and transfers have none.

- **A new transaction kind for loan principal** instead of excluded categories: every income/expense query already lists its kinds, so `debt` is left out everywhere by construction (fail-safe). The price is a one-time rebuild of `transactions` in v5, done now while there is no data on a phone.
- **Debts are personal.** Company loans stay company obligations or classified company ↔ personal transfers.
- **Occurrences are computed, not generated**: no background job, editing a rule changes its future dates, only resolved/adjusted dates are stored (UNIQUE per rule and date).
- **Bills are reserved after goals**, because goals are reserved explicitly; a location that cannot cover its bills is flagged rather than silently taking money from goals. Horizon 30 days (not configurable yet).
- **Payments are linked one-to-one** (a transaction settles one bill and repays one debt). A loan installment can be both: the bill is a schedule marker, the debt holds the money meaning, so nothing is counted twice.
- **Simple payout mode** is a per-company opt-in: the share is taken as net and final; approved-unpaid dividends are inside it (C = max(share, approved unpaid)).
- **Category groups for built-in categories are display-only themes**, so reports and existing data do not change; real parent categories still take precedence.
- **App icon** drawn as SVG and rasterised (no design files were provided); it can be replaced by dropping new PNGs in `assets/images/`.

## Decisions (Phase 4)

- **Restore swaps the data with SQLite's online backup API, not by moving files.** The staged copy is verified and migrated in memory, then copied into the open connection in one SQLite transaction (`backupDatabaseAsync`, `sqlite3_backup_step(-1)`). Closing the connection and moving files next to a WAL file risks applying a stale `-wal` to the new database, and a crash between two moves could leave no database; `SQLiteProvider` also closes its connection without letting the app await it. After the swap the same connection runs migrations and `quick_check`, every query is refreshed, and row counts are compared with the copy (mismatch → the recovery copy is put back).
- **Older backups are migrated before they reach the phone's data**, on the in-memory copy, so a failed migration changes nothing.
- **Recovery copy** = a verified snapshot of the current data in `money-tracker-recovery.db`, taken under the same lock as the swap so no write can fall between them. Only the latest is kept. Undo uses the same verified restore path, so it can be undone too.
- **Device-local metadata survives a restore**: device id, backup log, retention and account stay the phone's own; a Drive restore sets the baseline to that backup (no unsaved changes), a file or the recovery copy keeps the baseline it carries.
- **Change tracking with triggers** instead of comparing snapshots: exact and cheap. UI preferences (`settings`) do not count as changes. The rule for future tables is in PLAN.md and enforced by a test.
- **Device id**: random, stored in the database, kept across restores; a reinstall is a new device. Device names come from `expo-device` (model name), never an identifier.
- **Upload verification downloads the file again** and compares size and SHA-256 (not Drive's MD5), before anything is recorded or deleted.
- **Retention is per device** (default: keep 10) and never deletes another device's backups, the newest backup or files without a manifest. Old installs' backups therefore stay until deleted by hand; deleting the only valid backup is refused.
- **Divergence**: restoring over unsaved changes always requires an explicit choice; other-device and older-backup warnings appear only when the phone has data (after a reinstall restoring is the expected path). Backing up warns about a newer backup from another device and about backing up an empty phone while backups exist.
- **Drive metadata**: scalars in `appProperties`, row counts in `description` (124-byte property limit). Backups are named `money-tracker-<UTC time>.db`.
- **Google Sign-In**: the free "original" API of `@react-native-google-signin/google-signin` 16 with `webClientId` and `scopes: [drive.appdata]`, `offlineAccess: false`. No tokens are stored by the app; `getTokens` per request, `clearCachedAccessToken` + one retry on 401. The config plugin is used without options: the Firebase-file mods are no-ops without a file, and the iOS URL scheme option is not needed for Android.
- **Drive REST via `expo/fetch`**, which sends `Uint8Array` bodies as raw bytes (multipart upload in one request; DB sizes are a few MB).
- **Export rows are postings**, not transactions, so every row has exactly one owner and side totals cannot mix company and personal money. CSV has no totals; JSON totals are per side and per currency (no FX conversion). Company records (obligations, distributions, fiscal-year assumptions) are exported in full, not filtered.
- **Full backup file** is the raw SQLite snapshot (portable, opens in any SQLite tool); restoring it checks integrity and schema but has no SHA-256 to compare (no manifest travels with it). It is not encrypted; the screen says so.
- **`expo-file-system`'s own picker** (`File.pickFileAsync`) is used instead of adding `expo-document-picker`.
- **Web build**: Google Sign-In is replaced by a `.web.ts` stub that says "Android only"; export, backup files, restore from a file and undo work on web (expo-sqlite WASM supports `VACUUM INTO`, serialize/deserialize and backup).
- **Not changed**: package `dev.moneytracker.app`, the EAS keystore, Google Cloud configuration. `expo-dev-client` was added for the `development` profile; it is not active in preview/production builds.

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

- **Not tested on Android hardware**, including Google sign-in, Drive and the share sheet (Phase 4 checklist above). No JDK/adb on this Mac. On web, `Alert` dialogs in Phase 1–2 screens (delete and over-allocation confirmations) are no-ops in react-native-web; the Phase 3 screens use `lib/confirm.ts` and work on web.
- On web, `CI=1 expo start` does not watch files (restart after edits). Fast full-page reloads can hit expo-sqlite's OPFS lock ("createSyncAccessHandle"); a second reload fixes it. Neither affects Android.
- The custom date range uses the native date picker on Android, and a YYYY-MM-DD text field on web.
- No allocation history: goal progress over time and historical reservations are not shown.
- Insights are computed on demand (no notifications). Budget threshold warnings appear on Home/Analytics only.
- Products have no category/unit editor yet (the default unit is taken from the first purchase).
- Day totals in Activity only add up MAD expenses (unchanged from Phase 1).
- Company money: no accrual accounting (invoices, receivables, depreciation); the P&L is cash basis. No per-transaction TVA split; TVA is entered per year. No IS bracket tables (one rate, minimum or amount). No company balance-sheet items (capital, assets, owner current-account balance) beyond cash, obligations and reserves.
- The payout estimate (C) uses only the latest fiscal year that has started; profit of earlier years must be entered as retained earnings on that year.
- On web, the date fields in the fiscal-year form keep their typed text when another field changes them (the end date does not follow a new start date). Native pickers are unaffected.
- Text inputs have no accessible name beyond their placeholder (pre-existing in `TextField`).
- Backup is manual: there is no scheduled or automatic backup, and no reminder yet when changes are not backed up (Phase 5 notifications).
- Backups are not encrypted beyond what Google Drive provides; full backup files shared by the user are plain SQLite.
- Only one recovery copy is kept (the state before the latest restore or undo).
- Restoring a file has no SHA-256 check (no manifest travels with a `.db` file); integrity, schema and foreign keys are still checked.
- Backup history lists the signed-in Google account's backups only; switching accounts shows the other account's folder. Local records of uploads to other accounts are kept but not shown.
- The OAuth consent screen is in "Testing": Google may ask to sign in again every 7 days until it is published (`drive.appdata` is non-sensitive).
- No progress bar for upload/download (databases are small; the screen shows "Working…").
- Receipt OCR: **no Arabic** (ML Kit Latin model); itemisation works only on clearly printed, column-aligned receipts and is skipped when lines do not add up; store names from the top line can be wrong (marked "not sure"); quantity × price is kept only when it matches the line. The iOS Vision code is written but untested (no iOS build). OCR needs the new build; older builds and web attach the photo to an empty form.
- Receipt photos on Drive are never cleaned up automatically, even after every backup that used them is deleted (they are small and in the private app folder).
- A `.db` file (Export data → Full backup file) does not contain photos; restoring it uses the phone's photos, or Drive's when signed in.
- If the app is killed between writing a photo file and committing the expense, that file stays orphaned on the phone (no sweep yet). Photos of data replaced by a restore stay on the phone (the recovery copy may need them).
- Photos can only be attached to expenses.
- Bill reminders are in-app only (Home and Bills); phone notifications come with the notification work. The reservation horizon is fixed at 30 days.
- Bills cannot be settled by a transfer (for example paying a credit card); link an expense or a loan repayment instead.
- Debts have no interest schedule or amortisation table; interest is entered with each repayment. Forgiving a debt is not recorded as income or expense.
- The simple company estimate uses all company money and ignores obligations by design; switch back to the detailed mode for an accounting-based figure.

## Next (Phase 5 — finishing and extras)

1. Run the Phase 4 Android checklist on the S22 with the preview build, plus the Phase 5 screens (bills, debts, expense entry, icon), fix what it finds, then publish the OAuth consent screen.
2. ✅ Recurring bills and expected payments (and "bills" reservations in My Money), debts and receivables (migration v5).
3. ✅ Receipt attachments (migration v6), included in backups, and on-device receipt scanning (OCR) — device check pending.
4. Notifications: budget thresholds, obligations due, "not backed up for N days" reminder.
5. Optional automatic backup (e.g. after N changes or daily on Wi-Fi), still never overwriting other devices' backups.
6. Carried over: allocation history for goal charts; ✅ filtering entry-screen categories by ownership; moving Phase 1–2 confirmations to `lib/confirm.ts`; accessible names for text inputs.
7. Performance testing with a few years of data (balances, analytics, snapshot/restore time), security review, UI polish; OCR tuning from real S22 receipts.
