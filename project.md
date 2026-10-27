# Claude Code — Personal Finance, Expense Tracker & Money Management App

You are a senior React Native / Expo developer, financial software architect, SQLite database engineer, and mobile UI/UX specialist.

Build a production-quality, Android-first personal finance application for my Samsung Galaxy S22.

## 1. Project overview

**Tech stack:**
- React Native + Expo + TypeScript
- Expo Router
- SQLite for local-first storage
- Google Sign-In
- Google Drive private backup and restoration
- Zustand and TanStack Query where appropriate
- Modern native mobile UI
- Currency: MAD (Moroccan Dirham), with support for other currencies where needed

The application must work completely offline for normal financial tracking.

I live in Morocco and operate a Moroccan SARL company. I want to manage family spending, income, savings, cash, bank accounts, and company-related funds from one mobile application.

The application should answer five questions:

1. How much money do I have right now, and where is it?
2. How much did I earn and spend?
3. Where exactly is my money going?
4. How much can I safely save or spend?
5. How much of my company money could potentially become personal money after taxes and other obligations?

Build an actual functioning application, not mock screens.

---

# PART A — MONEY LOCATIONS & BALANCES

## 2. Track all my money and where it is

**This is a critical feature and must be implemented in Phase 1.**

I want to know where every dirham is located.

Examples of money locations:

**Personal money:**
- Personal bank account
- Additional bank accounts
- Cash in my physical wallet
- Cash stored at home
- Cash stored somewhere else
- Prepaid cards with independent balances
- Savings accounts
- Other custom locations

**Business money:**
- SARL company bank account
- Additional business bank accounts
- Company cash
- Other company money locations

Allow unlimited custom money locations.

Each location should have:

- Name
- Type
- Personal or business ownership
- Currency
- Opening balance
- Opening balance date
- Current calculated balance
- Optional institution
- Optional notes
- Active/archived status

### Example

Suppose I record:

| Money location | Balance |
|---|---:|
| Personal bank | 20,000 DH |
| Wallet cash | 800 DH |
| Cash at home | 5,000 DH |
| Savings account | 15,000 DH |
| Company bank | 100,000 DH |

The app should show:

**Personal money: 40,800 DH**

**Company bank money: 100,000 DH**

Do NOT automatically add company money to personal money.

Show each subtotal separately, and optionally a consolidated overview that clearly distinguishes ownership and avoids double counting.

### Bank cards

A normal debit card linked to my personal bank account does not represent additional money.

For example:

- Personal bank balance: 20,000 DH
- Debit card linked to that account

My money is still 20,000 DH, not 40,000 DH.

Support:

- Debit cards linked to accounts.
- Credit cards with outstanding liabilities.
- Prepaid cards with independent stored balances.

Only independently funded prepaid balances count as separate money locations.

## 3. Money transfers between locations

Allow transferring money from one location to another.

Examples:

- Personal bank → Wallet
- Wallet → Cash at home
- Personal bank → Savings account
- Cash at home → Personal bank
- Business bank → Personal bank, when legally appropriate and correctly classified

Example:

Before transfer:
- Personal bank: 20,000 DH
- Wallet: 500 DH

Transfer 1,000 DH from personal bank to wallet.

After transfer:
- Personal bank: 19,000 DH
- Wallet: 1,500 DH

Total personal money remains 20,500 DH.

Transfers must not count as income or expenses.

Support transfer dates, notes, fees, and transfers between different currencies.

Company-to-personal transfers must require a classification, such as salary, dividend/distribution, expense reimbursement, loan repayment, or another appropriate transaction type.

Do not treat every company-to-personal transfer as tax-free income.

## 4. Balance calculation and adjustments

Balances must be calculated using:

Opening balance + recorded inflows - recorded outflows.

Examples:

- Receive salary → personal bank increases.
- Buy groceries using bank card → linked bank decreases.
- Pay with wallet cash → wallet decreases.
- Withdraw cash from an ATM → transfer from bank to wallet.
- Move money into savings → transfer, not expense.

Allow manually checking an account's balance.

If the actual balance differs from the calculated balance, provide a reconciliation workflow.

Example:

App balance: 4,500 DH  
Actual bank balance: 4,400 DH  
Difference: -100 DH

Let me investigate the discrepancy or record an explicit, auditable balance adjustment.

Never silently overwrite transaction history or invent income to reconcile balances.

Support transaction editing, deletion, and recalculation.

## 5. Money dashboard

Create a dedicated **My Money** screen.

At the top:

- Personal available cash
- Total personal bank balances
- Cash across all physical locations
- Personal savings balances
- Personal liquid assets
- Outstanding personal liabilities
- Personal net liquid position

Then display each money location as a card showing its balance.

Include a breakdown chart showing where my personal liquid money is held.

Example:

Personal Money — 40,800 DH

- Personal bank: 49%
- Savings: 37%
- Cash at home: 12%
- Wallet: 2%

Include quick actions:

- Add money location
- Transfer money
- Record income
- Record expense
- Reconcile balance
- View balance history

Allow seeing total balances for previous dates using recorded transactions.

Provide daily, weekly, monthly, and yearly balance trends.

Distinguish available money from reserved money, debts, and financial assets that cannot be spent immediately.

---

# PART B — COMPANY MONEY & AFTER-TAX ESTIMATES

## 6. Moroccan SARL money tracking

I own and operate a Moroccan SARL.

My company receives revenue, incurs expenses, pays salaries, and owes taxes.

I want to understand the company's financial position and estimate how much could potentially be distributed to owners.

This is a planning tool, not a replacement for my accountant.

Track:

- Company bank balances
- Company cash
- Company revenue
- Company expenses
- Salaries
- Payroll obligations
- Corporate income tax (IS)
- VAT/TVA obligations where applicable
- Other liabilities
- Tax payments already made
- Tax provisions
- Estimated distributable profits
- Ownership percentage
- Potential distribution taxes

### Company overview

Example:

Company bank: 100,000 DH

But this does not mean I personally own 100,000 DH that I can immediately withdraw.

The company may have taxes, salaries, supplier obligations, reserves, and other commitments.

Create a separate company financial dashboard showing:

1. Actual company cash and bank balances.
2. Outstanding financial obligations.
3. Restricted/reserved company funds.
4. Estimated liquidity after obligations.
5. Accounting profit, when enough data exists.
6. Estimated potentially distributable profits.
7. Estimated owner's share after applicable taxes.

Do not equate bank balance with accounting profit.

Do not equate ownership percentage with a direct right to withdraw that percentage of company cash.

### Tax estimation

Create a configurable tax estimation module.

Support:

- Accounting/fiscal year
- Revenue
- Deductible expenses
- Taxable profit adjustments
- Applicable IS rate
- Estimated IS
- Advance tax payments
- Remaining estimated IS
- Dividend/distribution withholding tax
- Additional configurable taxes or obligations
- Ownership percentage
- Legal or accounting reserves

Default to user-entered amounts for taxes and liabilities.

If automatic tax formulas are introduced, only use rules verified for the selected Moroccan fiscal year. Show the applicable assumptions and make every estimate editable.

Never silently assume that all bank deposits are taxable profits or that all business cash is legally distributable.

### Distribution simulation

Provide an interactive calculator.

Example inputs:

- Estimated distributable profit: 60,000 DH
- My ownership: 95%
- Distribution tax rate: user-configured
- Proposed distribution: 40,000 DH

Calculate the expected owner allocation and estimated net distribution, using applicable tax assumptions.

Label the result:

**Estimated potential personal payout — not yet personal money.**

Do not include this amount in my actual personal balance until the distribution is approved/recorded and paid.

Support the difference between:

- Company bank balance
- Company profit
- Estimated distributable profit
- Approved distribution
- Actual distribution received

### Company and personal overview

Create three clearly separated financial totals:

**A. My actual personal money**

Money already personally owned and recorded in personal accounts.

**B. Company financial position**

Company assets, cash, and obligations.

**C. Potential future personal payout**

Estimated money that might legally become personally available after company obligations, applicable tax, distribution decisions, and ownership allocation.

Never simply add A + B + C.

Provide optional scenarios, but clearly label estimates and avoid double counting.

---

# PART C — EXPENSE & INCOME TRACKING

## 7. Fast expense entry

I regularly shop at supermarkets and traditional Moroccan shops.

Sometimes I receive a receipt. Sometimes I do not.

Manual entry must be extremely fast.

Example:

I spent 100 DH at Moul Lkhodra.

Record:

- Expense: 100 DH
- Merchant: Moul Lkhodra
- Category: Groceries
- Payment location: Wallet
- Date: Today

Save immediately.

My wallet balance should automatically decrease.

Every expense must have a money source where possible, with sensible defaults.

Support custom dates and editing older transactions.

## 8. Itemized purchases

Allow optionally adding individual products.

Example:

Moul Lkhodra — 100 DH

- Tomatoes: 2 kg × 10 DH = 20 DH
- Potatoes: 3 kg × 7 DH = 21 DH
- Onions: 1 kg × 8 DH = 8 DH
- Other vegetables: 51 DH

The recorded payment is 100 DH.

Support:

- Product name
- Quantity
- Unit
- Unit price
- Total price
- Optional category
- Optional tags
- Notes

Supported units include kg, g, litre, ml, piece, pack, bottle, and custom units.

Itemized purchases must remain optional.

Allow incomplete information.

Never fabricate missing quantities or prices.

If item totals do not match the amount paid, show the discrepancy and support explicit discounts, charges, or unallocated amounts.

## 9. Product catalog and price history

Maintain a reusable catalog.

Examples:

- Chicken breast
- Tomatoes
- Eggs
- Milk
- Bread
- Potatoes
- Tuna
- Coffee
- Rice

Track:

- Quantity purchased
- Total spent
- Latest price
- Average normalized price
- Price changes over time
- Merchant comparisons
- Purchase frequency

Example insight:

"You purchased 12 kg of chicken this month and spent 780 DH."

Only calculate quantities when recorded units are compatible.

## 10. Categories, groups, and tags

Create editable default categories:

- Groceries
- Meat & Fish
- Vegetables & Fruit
- Snacks
- Restaurants
- Coffee
- Petrol
- Transport
- Car Maintenance
- Electricity
- Water
- Gas
- Internet
- Mobile
- Healthcare
- Pregnancy
- Child Expenses
- Clothes
- Gym
- Supplements
- Entertainment
- House Maintenance
- Gifts
- Business Expenses
- Miscellaneous

Support hierarchical categories and user-created groups.

Allow optional custom tags.

Examples:

- Wife Snacks
- My Snacks
- Child
- Gym Diet
- Essential
- Optional
- Unnecessary Spending
- Weekend Purchases

Transactions and individual products can have multiple tags.

Avoid double counting overlapping tags in totals.

Allow merging and renaming products, merchants, tags, and categories without losing history.

## 11. Merchant tracking

Examples:

- BIM
- Carrefour
- Marjane
- Moul Lhanout
- Moul Lkhodra
- Butcher
- Pharmacy
- Petrol station

Store merchants for reuse.

Show:

- Total spending per merchant
- Monthly spending
- Purchase frequency
- Average purchase amount
- Product price comparisons

Merchant addresses and business registration information are optional.

## 12. Income tracking

Support:

- Salary
- Dividends
- Freelancing
- Business distributions
- Gifts
- Refunds
- Other sources

Each income transaction should specify the destination money location.

Example:

Salary received: 8,000 DH  
Destination: Personal bank

Personal bank balance increases by 8,000 DH.

Support recurring expected income, but do not treat expected income as received until recorded.

Avoid double counting transfers, reimbursements, and internal movements as new earnings.

---

# PART D — FINANCIAL ANALYTICS

## 13. Dashboard

Create a professional home dashboard.

Display:

- Money currently available
- Monthly income
- Monthly spending
- Monthly savings
- Savings rate
- Spending budget
- Remaining budget
- Recent transactions
- Largest spending categories

Include a shortcut to the detailed My Money dashboard.

Use modern, readable financial charts.

## 14. Date filters

Support:

- Today
- Yesterday
- This week
- Last week
- This month
- Last month
- Last 30 days
- Last 90 days
- This year
- Previous year
- Custom date range

Use Africa/Casablanca as the default timezone.

Support comparing periods.

Examples:

- October versus September
- This week versus last week
- Current year versus previous year

For partial periods, make the comparison method explicit.

## 15. Detailed analytics

Allow analyzing spending and income by:

- Category
- Subcategory
- Tag
- Product
- Merchant
- Account
- Money location
- Payment method
- Date range

Metrics:

- Total income
- Total expenses
- Net cash flow
- Net savings
- Average daily spending
- Average weekly spending
- Average monthly spending
- Spending by product
- Spending by merchant
- Category budget usage
- Month-over-month changes

Distinguish calendar-day averages from averages across active spending days.

Enable drilling down from charts directly into transactions.

## 16. Spending insights

Generate useful rule-based insights.

Examples:

- "You spent 340 DH on snacks this month."
- "Your grocery spending increased 15%."
- "You spent 900 DH on petrol."
- "Your average daily spending is 250 DH."
- "Your cheapest recorded chicken price was 62 DH/kg."
- "Your monthly expenses are approaching your budget."

Support identifying essential versus discretionary spending.

Avoid AI-generated financial claims without evidence.

Explain calculations where relevant.

---

# PART E — BUDGETS AND SAVINGS

## 17. Monthly budgets

Allow setting:

- Total monthly spending limit
- Category budgets
- Weekly budgets
- Custom-period budgets

Example:

Monthly budget: 8,000 DH

- Groceries: 3,300 DH
- Utilities: 900 DH
- Transport: 1,400 DH
- Healthcare: 650 DH
- Other: remaining budget

Show:

- Budget
- Actual spending
- Remaining amount
- Percentage used
- Days remaining
- Projected spending

Support warnings at configurable thresholds such as 75%, 90%, and 100%.

Changing a budget should not modify historical actual transactions.

## 18. Savings goals

Support unlimited goals.

Examples:

- Emergency fund
- Maternity expenses
- Car maintenance
- Family holiday
- House repairs
- Custom goals

Each goal includes:

- Goal name
- Target amount
- Current amount allocated
- Target date
- Planned monthly contribution
- Progress percentage

Important: savings goals should connect naturally to money locations.

Example:

I have 15,000 DH in my savings account.

Of that money:

- 10,000 DH allocated to emergency fund
- 5,000 DH allocated to maternity fund

The account still contains 15,000 DH.

Do not add the goal allocations as additional assets.

Allow goals to reserve portions of actual accounts without moving or duplicating money.

Distinguish:

- Total personal money
- Money reserved for goals
- Money reserved for bills
- Unallocated available money

Prevent allocating more money than is available without explicit warning.

## 19. Financial planning

Allow entering:

- Expected monthly income
- Spending target
- Savings target
- Planned major purchases
- Expected large upcoming bills

Example:

Monthly income: 15,000 DH  
Planned spending: 8,000 DH  
Maternity savings: 3,000 DH  
Other savings: 4,000 DH

Show how much is available to allocate.

Provide projections clearly separated from actual balances.

---

# PART F — RECURRING PAYMENTS & OBLIGATIONS

## 20. Recurring expenses

Support:

- Monthly payments
- Quarterly payments
- Annual payments
- Custom recurring intervals

Examples:

- Internet subscription
- Electricity
- Water
- Car insurance
- Car tax/vignette
- Subscriptions
- Health expenses
- Other bills

Allow recording expected payments without reducing actual account balances.

Only confirmed actual payments should affect balances.

Support bill reminders.

## 21. Debts, receivables, and reserved funds

Track:

- Money I owe
- Money others owe me
- Credit card balances
- Loans
- Bills due
- Company obligations separately

Do not treat money someone owes me as cash already available.

Separate:

- Liquid money
- Receivables
- Liabilities
- Reserved money
- Potential future income

Support repayment tracking and due dates.

Calculate personal net position without confusing gross balances with liabilities.

---

# PART G — GOOGLE SIGN-IN & DRIVE BACKUP

## 22. Authentication

Implement Google Sign-In compatible with the current Expo SDK.

Support:

- Sign in
- Sign out
- Secure token handling
- Session persistence
- Multiple account isolation

Google authentication must not require a custom backend.

Use the minimum OAuth scopes required.

Document Android OAuth configuration.

## 23. Google Drive backup and restoration

I want my data stored in local SQLite and safely backed up to my Google Drive.

In Settings add:

**Sync to Google Drive**

The app should:

1. Safely snapshot the SQLite database.
2. Include relevant attachment files.
3. Save a private backup in Google Drive.
4. Record backup date and version.
5. Verify upload completion.
6. Allow recovery on another Android device.

Use Google Drive's private application-data folder where appropriate.

Do not request unrestricted access to my Drive.

Support:

- Manual sync
- Backup history
- Restore
- Backup integrity checks
- Error handling
- Offline use
- Safe handling of conflicts
- Schema migrations
- Recovery copies

SQLite WAL mode must be handled correctly when generating consistent backups.

Never overwrite newer local data blindly.

If full two-way sync cannot be safely implemented initially, implement reliable manual backup/restore and clearly warn about diverging device data.

Do not pretend backup and real-time sync are equivalent.

Backups must include:

- Expenses
- Income
- Money locations
- Opening balances
- Transfers
- Reconciliations
- Company financial data
- Product history
- Budgets
- Savings goals
- Tags
- Merchants
- Relevant attachment files

## 24. Export

Support CSV and JSON export.

Allow exporting selected dates and categories.

Provide portable local backups without requiring Google Drive.

---

# PART H — RECEIPT SCANNING

## 25. Optional receipt OCR

Receipt scanning is useful but must not delay the application's core features.

Initially support optionally attaching a receipt photo to a transaction.

Later, evaluate OCR.

Expected flow:

1. Photograph receipt.
2. Extract merchant, date, items, quantities, prices, and total.
3. Display editable results.
4. Allow corrections.
5. Confirm totals.
6. Save transaction and products.

Never save uncertain OCR output automatically.

If accurate OCR is expensive or complicated, skip it and prioritize manual input.

---

# PART I — UI/UX DESIGN

## 26. Navigation

Use a polished Android mobile design optimized for my Samsung Galaxy S22.

Suggested navigation:

- Home
- Transactions
- My Money
- Analytics
- Goals

Settings should remain easy to access from the Home/profile area.

The My Money tab is important and should not be hidden inside Settings.

## 27. Visual design

Requirements:

- Modern finance-app aesthetic
- Light and dark mode
- Good spacing and typography
- Clear balance cards
- Interactive charts
- Smooth bottom sheets
- Native date pickers
- Accessible colors
- Responsive layouts
- Proper keyboard handling
- Search and autocomplete
- Android safe areas
- Fast loading
- No unnecessary animations

Use a clear distinction between personal money, company funds, liabilities, and estimates.

Provide intuitive actions to add, spend, receive, and transfer money.

## 28. Fast actions

Add a prominent "+" action accessible throughout the app.

Options:

- Expense
- Income
- Transfer
- Add money location
- Balance adjustment

For expenses, use quick-entry mode by default.

Minimize the number of taps required.

Support recent merchant, product, and category suggestions.

---

# PART J — ARCHITECTURE, TESTING & DELIVERY

## 29. SQLite database

Design the schema to support:

- Profiles
- Money locations/accounts
- Payment instruments
- Account opening balances
- Financial transactions
- Transfer relationships
- Balance adjustments
- Reconciliations
- Merchants
- Products
- Purchase items
- Categories
- Tags
- Budgets
- Savings goals
- Goal allocations
- Recurring payments
- Debts and receivables
- Company profiles
- Ownership information
- Company tax estimates
- Company liabilities and reserves
- Distribution simulations
- Actual company distributions
- Sync metadata
- Attachments
- Settings

Use UUIDs, database migrations, indexes, and appropriate foreign keys.

Use precise monetary representations, preferably integer minor units, with correct currency handling.

Keep balance calculations centralized in a ledger/accounting service.

Never store a manually edited balance as the only source of truth without an auditable adjustment record.

Handle multi-account transfers atomically.

Support historical balances.

## 30. Testing

Write tests for:

- Income affecting account balances.
- Expense affecting the correct account.
- Transfer preserving total personal money.
- Debit card payments not double-counting balances.
- Prepaid card balances.
- Balance reconciliation.
- Currency conversions.
- Transaction editing and deletion.
- Historical balance calculations.
- Personal versus company separation.
- Company liabilities and tax provisions.
- Estimated distributions.
- Ownership percentage calculations.
- Goal allocations not double-counting assets.
- Category spending totals.
- Product unit calculations.
- Tag overlap.
- Database backup/restore.
- Conflict handling.
- Offline persistence.

Financial correctness is mandatory.

## 31. Implementation phases

### Phase 1 — Core financial tracking

Implement:

- Expo app setup
- Navigation
- SQLite schema and migrations
- Money locations
- Opening balances
- Personal versus company accounts
- Debit/prepaid card distinctions
- Income
- Expenses
- Transfers
- Balance reconciliation
- Fast expense entry
- Basic categories and merchants
- Itemized purchases
- Transaction history
- My Money dashboard

**Phase 1 must already let me see how much money I have and where it is.**

### Phase 2 — Analytics and savings

Implement:

- Detailed spending analytics
- Product catalog
- Product price history
- Category management
- Tags
- Budgets
- Savings goals
- Goal allocations
- Historical account balances
- Financial insights

### Phase 3 — Company money

Implement:

- SARL dashboard
- Tax and obligation estimates
- Profit tracking
- Company reserves
- Ownership share
- Distribution simulator
- Company/personal financial separation

### Phase 4 — Authentication and backup

Implement:

- Google Sign-In
- Google Drive integration
- Safe database backup
- Restore
- Conflict handling
- Cross-device recovery
- CSV/JSON export

### Phase 5 — Finishing and extras

Implement:

- Recurring bills
- Debts/receivables
- Optional receipt attachments
- Notification system
- UI polish
- Security improvements
- Performance testing
- Optional receipt OCR

## 32. Development workflow

Before implementation:

1. Inspect the existing project.
2. Research current official Expo and relevant library documentation.
3. Select maintained, compatible dependencies.
4. Produce a concise architecture.
5. Create `PLAN.md`.
6. Create `PROGRESS.md`.
7. Define the SQLite database schema.
8. Design the financial ledger and company/personal account separation.

Then start implementing Phase 1.

Do not spend the entire session planning.

Use actual working code and test it.

At the end of each phase:

- Run TypeScript validation.
- Run relevant tests.
- Fix implementation errors.
- Update documentation.
- Record remaining tasks.
- Preserve a working project state.

## 33. Android deployment

I develop using a MacBook and want to install the app on my Samsung Galaxy S22.

Provide instructions to:

- Run Expo locally.
- Connect my S22 using USB or Wi-Fi.
- Build an Android development client.
- Install a test APK.
- Configure Google authentication.
- Produce a release APK.
- Test database persistence.
- Test backup/restore after reinstalling.

Avoid unnecessary subscriptions and cloud hosting.

## 34. Final acceptance criteria

The application should allow me to:

1. Enter all the locations where I keep money.
2. See my total actual personal money instantly.
3. See exactly how much is in each bank account or cash location.
4. Track company funds separately.
5. Estimate potential after-tax company distributions.
6. Transfer money between locations without changing total wealth.
7. Record spending and automatically decrease the appropriate balance.
8. Record income and increase the appropriate balance.
9. Reconcile recorded balances against actual balances.
10. Record detailed shopping items or only a quick total.
11. Track product prices over time.
12. Analyze spending by date, category, product, merchant, and tag.
13. Set budgets and monitor spending limits.
14. Create savings goals without double-counting savings balances.
15. Track personal debts and company obligations separately.
16. Use the application completely offline.
17. Back up the financial database to Google Drive.
18. Restore my records on another Android device.
19. Export all data.
20. Install and use the application on my S22.

The most important principle:

**One dirham must never be counted twice.**

I want one reliable, easy-to-use place to understand how much money I have, where it is, how I spend it, what belongs to my business, and how much I can realistically save.

Start implementing Phase 1 with working code.
