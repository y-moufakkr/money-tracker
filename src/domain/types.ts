export type Ownership = 'personal' | 'business';

export type AccountKind = 'bank' | 'cash' | 'savings' | 'prepaid' | 'ewallet' | 'credit_card' | 'other';

export const ACCOUNT_KINDS: { kind: AccountKind; label: string; icon: string; hint: string }[] = [
  { kind: 'bank', label: 'Bank account', icon: 'account_balance', hint: 'Current or checking account' },
  { kind: 'cash', label: 'Cash', icon: 'payments', hint: 'Wallet, cash at home, safe…' },
  { kind: 'savings', label: 'Savings account', icon: 'savings', hint: 'Money set aside in a savings account' },
  { kind: 'prepaid', label: 'Prepaid card', icon: 'credit_card', hint: 'Card with its own loaded balance' },
  { kind: 'ewallet', label: 'Mobile wallet', icon: 'smartphone', hint: 'Mobile money or e-wallet balance' },
  { kind: 'credit_card', label: 'Credit card', icon: 'credit_score', hint: 'Money you owe — a liability' },
  { kind: 'other', label: 'Other', icon: 'wallet', hint: 'Any other place you keep money' },
];

export function accountKindLabel(kind: AccountKind): string {
  return ACCOUNT_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

export function accountKindIcon(kind: AccountKind): string {
  return ACCOUNT_KINDS.find((k) => k.kind === kind)?.icon ?? 'wallet';
}

export function isLiabilityKind(kind: AccountKind): boolean {
  return kind === 'credit_card';
}

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  ownership: Ownership;
  companyId: string | null;
  currency: string;
  openingBalanceMinor: number;
  openingDate: string;
  institution: string | null;
  notes: string | null;
  color: string | null;
  sortOrder: number;
  isArchived: boolean;
};

export type AccountWithBalance = Account & { balanceMinor: number };

/** How company income/expenses are recorded: TVA included (TTC) or not (HT / not liable). */
export type TvaMode = 'ttc' | 'ht';

/**
 * How the potential payout to you is estimated: from fiscal years and tax assumptions
 * ('detailed'), or as one entered net share of current company money ('simple').
 */
export type PayoutMode = 'detailed' | 'simple';

export type Company = {
  id: string;
  name: string;
  legalForm: string;
  /** Your share of the company in basis points. A share of profit distributions, never a right to company cash. */
  ownershipBp: number;
  currency: string;
  fiscalYearStartMonth: number;
  tvaMode: TvaMode;
  payoutMode: PayoutMode;
  /** Simple mode: your net share of current company money, in basis points (2800 = 28 %). */
  simplePayoutBp: number | null;
};

export type InstrumentKind = 'debit' | 'credit' | 'prepaid';

export type PaymentInstrument = {
  id: string;
  name: string;
  kind: InstrumentKind;
  accountId: string;
  last4: string | null;
  isArchived: boolean;
};

export type CategoryKind = 'expense' | 'income';

export type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  essential: boolean | null;
  isSystem: boolean;
  isArchived: boolean;
};

export type Merchant = {
  id: string;
  name: string;
  defaultCategoryId: string | null;
};

/** `debt`: loan principal moving in or out of a personal location (Phase 5). Never income or expense. */
export type TransactionKind = 'expense' | 'income' | 'transfer' | 'adjustment' | 'debt';

export type TransferClass =
  | 'internal'
  | 'salary'
  | 'dividend'
  | 'expense_reimbursement'
  | 'owner_loan'
  | 'loan_repayment'
  | 'capital_contribution'
  | 'other';

export const CROSS_OWNERSHIP_CLASSES: { value: TransferClass; label: string; hint: string }[] = [
  { value: 'salary', label: 'Salary', hint: 'Payroll paid by the company — personal income, subject to IR/CNSS' },
  { value: 'dividend', label: 'Dividend / distribution', hint: 'Approved profit distribution — subject to withholding tax' },
  { value: 'expense_reimbursement', label: 'Expense reimbursement', hint: 'Repaying business costs you paid personally — not income' },
  { value: 'owner_loan', label: "Owner's current account / loan", hint: 'Money lent between you and the company — must be repaid' },
  { value: 'loan_repayment', label: 'Loan repayment', hint: 'Repayment of an earlier loan — not income' },
  { value: 'capital_contribution', label: 'Capital contribution', hint: 'You putting capital into the company' },
  { value: 'other', label: 'Other (explain in note)', hint: 'Anything else — describe it in the note' },
];

export function transferClassLabel(c: TransferClass | null): string {
  if (!c || c === 'internal') return 'Transfer';
  return CROSS_OWNERSHIP_CLASSES.find((x) => x.value === c)?.label ?? c;
}

/** Business → personal transfers of these classes are personal income. */
export const PERSONAL_INCOME_TRANSFER_CLASSES: TransferClass[] = ['salary', 'dividend'];

export type ItemLineKind = 'product' | 'discount' | 'charge' | 'unallocated';

export type PurchaseItemInput = {
  lineKind: ItemLineKind;
  name: string;
  quantityMilli: number | null;
  unit: string | null;
  unitPriceMinor: number | null;
  totalMinor: number | null;
  notes?: string | null;
  /** Tags on this line only. Undefined on input means none. */
  tagIds?: string[];
  /** The total is an estimated share of the amount paid, not a recorded price. */
  estimated?: boolean;
};

export type PurchaseItem = PurchaseItemInput & {
  id: string;
  productId: string | null;
  sortOrder: number;
  tagIds: string[];
};

export const UNITS = ['kg', 'g', 'L', 'ml', 'piece', 'pack', 'bottle', 'dozen', 'box'];

export type Posting = {
  id: string;
  accountId: string;
  amountMinor: number;
  role: 'main' | 'from' | 'to';
};

export type Transaction = {
  id: string;
  kind: TransactionKind;
  date: string;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  merchantId: string | null;
  instrumentId: string | null;
  transferClass: TransferClass | null;
  parentId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReconciliationStatus = 'matched' | 'open' | 'adjusted';

export type Reconciliation = {
  id: string;
  accountId: string;
  date: string;
  statementBalanceMinor: number;
  calculatedBalanceMinor: number;
  differenceMinor: number;
  status: ReconciliationStatus;
  adjustmentTransactionId: string | null;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type Tag = {
  id: string;
  name: string;
  color: string | null;
  isArchived: boolean;
};

export type BudgetPeriod = 'weekly' | 'monthly' | 'custom';

export type BudgetLine = { id: string; categoryId: string; amountMinor: number };

export type Budget = {
  id: string;
  name: string;
  period: BudgetPeriod;
  /** Custom periods only. */
  startDate: string | null;
  endDate: string | null;
  /** Overall spending limit; null means "the sum of the category lines". */
  amountMinor: number | null;
  currency: string;
  /** Warning thresholds in percent, ascending, e.g. [75, 90, 100]. */
  thresholds: number[];
  isArchived: boolean;
  lines: BudgetLine[];
};

export type SavingsGoal = {
  id: string;
  name: string;
  targetMinor: number;
  currency: string;
  targetDate: string | null;
  monthlyPlanMinor: number | null;
  icon: string | null;
  color: string | null;
  notes: string | null;
};

export type GoalAllocation = {
  id: string;
  goalId: string;
  accountId: string;
  /** In the account's currency. */
  amountMinor: number;
};

// ---------------------------------------------------------------------------
// Company money (Phase 3). None of these records hold money: balances only
// change through real transactions.

export type FiscalYear = {
  id: string;
  companyId: string;
  label: string;
  startDate: string;
  endDate: string;
  isClosed: boolean;
  notes: string | null;
};

/** User-entered figures for one fiscal year. Null means "not entered" (never guessed). */
export type TaxAssumptions = {
  fiscalYearId: string;
  isRateBp: number | null;
  /** Minimum tax amount, when the year has one (entered, not computed). */
  isMinimumMinor: number | null;
  /** Replaces the computed IS when set. */
  isOverrideMinor: number | null;
  /** IS already paid for this year but not recorded in the app. */
  isPaidOutsideMinor: number;
  withholdingRateBp: number | null;
  legalReserveRateBp: number | null;
  /** TVA included in recorded revenue / expenses (TTC companies only). */
  tvaCollectedMinor: number | null;
  tvaDeductibleMinor: number | null;
  /** HT figures for the part of the year before the company accounts were tracked here. */
  preTrackingRevenueMinor: number | null;
  preTrackingExpensesMinor: number | null;
  /** Retained earnings brought forward (+) or losses carried forward (−). */
  retainedEarningsMinor: number;
  sourceNote: string | null;
  updatedAt: string | null;
};

export type TaxItemKind = 'adjustment' | 'other_tax';

export type TaxItem = {
  id: string;
  fiscalYearId: string;
  kind: TaxItemKind;
  label: string;
  /** Adjustment: signed (+ add-back, − deduction). Other tax: fixed amount. */
  amountMinor: number | null;
  /** Other tax as a rate of `base`. */
  rateBp: number | null;
  base: 'revenue' | 'taxable_profit' | null;
  sourceNote: string | null;
};

export type ReserveKind = 'legal' | 'statutory' | 'cash';

export const RESERVE_KINDS: { kind: ReserveKind; label: string; hint: string }[] = [
  { kind: 'legal', label: 'Legal reserve', hint: 'Part of a year\'s profit that must stay in the company — reduces distributable profit' },
  { kind: 'statutory', label: 'Statutory / other profit reserve', hint: 'Profit kept by decision or by the statutes — reduces distributable profit' },
  { kind: 'cash', label: 'Cash set aside', hint: 'Company cash kept for a purpose (runway, investment…) — reduces liquidity' },
];

export type CompanyReserve = {
  id: string;
  companyId: string;
  fiscalYearId: string | null;
  kind: ReserveKind;
  name: string;
  amountMinor: number;
  notes: string | null;
};

export type LiabilityKind = 'is' | 'tva' | 'payroll' | 'supplier' | 'cnss' | 'withholding' | 'dividend' | 'other';

export const LIABILITY_KINDS: { kind: LiabilityKind; label: string; icon: string }[] = [
  { kind: 'is', label: 'Corporate tax (IS)', icon: 'account_balance' },
  { kind: 'tva', label: 'TVA', icon: 'receipt' },
  { kind: 'payroll', label: 'Payroll', icon: 'badge' },
  { kind: 'cnss', label: 'CNSS', icon: 'health_and_safety' },
  { kind: 'supplier', label: 'Supplier', icon: 'local_shipping' },
  { kind: 'withholding', label: 'Dividend withholding', icon: 'percent' },
  { kind: 'dividend', label: 'Dividends to other partners', icon: 'groups' },
  { kind: 'other', label: 'Other', icon: 'pending_actions' },
];

export function liabilityKindLabel(kind: LiabilityKind): string {
  return LIABILITY_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

export type DistributionStatus = 'approved' | 'cancelled';

/** A simulated distribution: never money, never in any balance. */
export type DistributionSimulation = {
  id: string;
  companyId: string;
  fiscalYearId: string | null;
  name: string | null;
  distributableMinor: number;
  ownershipBp: number;
  withholdingBp: number;
  /** Total distribution proposed to all partners. */
  proposedMinor: number;
  ownerGrossMinor: number;
  withholdingMinor: number;
  netMinor: number;
  notes: string | null;
  createdAt: string;
};
