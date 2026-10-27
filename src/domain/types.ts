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

export type Company = {
  id: string;
  name: string;
  legalForm: string;
  ownershipBp: number;
  currency: string;
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

export type TransactionKind = 'expense' | 'income' | 'transfer' | 'adjustment';

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
};

export type PurchaseItem = PurchaseItemInput & {
  id: string;
  productId: string | null;
  sortOrder: number;
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
