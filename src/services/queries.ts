import type { BindValue, Db } from '@/db/types';
import { todayISO } from '@/domain/dates';
import { BASE_CURRENCY, convertToBase } from '@/domain/money';
import {
  PERSONAL_INCOME_TRANSFER_CLASSES,
  type Category,
  type CategoryKind,
  type Tag,
  type ItemLineKind,
  type Merchant,
  type Ownership,
  type PurchaseItem,
  type Transaction,
  type TransactionKind,
  type TransferClass,
} from '@/domain/types';
import { mapCategory, type CategoryRow } from './catalog';
import { latestRates } from './fx';

// ---------------------------------------------------------------------------
// Transaction list

export type TxAccountRef = { id: string; name: string; ownership: Ownership; currency: string; amountMinor: number };

export type TransactionListItem = {
  id: string;
  kind: TransactionKind;
  date: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  transferClass: TransferClass | null;
  parentId: string | null;
  category: { id: string; name: string; icon: string | null; color: string | null } | null;
  merchantName: string | null;
  itemCount: number;
  /** Comma-separated transaction-level tag names. */
  tagNames: string | null;
  /** Expense / income / adjustment account. */
  account: TxAccountRef | null;
  from: TxAccountRef | null;
  to: TxAccountRef | null;
};

/** Filter values that match transactions without a category, tag or merchant. */
export const NO_CATEGORY = '__none__';
export const NO_TAG = '__none__';
export const NO_MERCHANT = '__none__';

export type EssentialClass = 'essential' | 'discretionary' | 'unclassified';

export type TransactionFilter = {
  from?: string;
  to?: string;
  accountId?: string;
  kinds?: TransactionKind[];
  /** A category id, or NO_CATEGORY. */
  categoryId?: string;
  /** Also match the category's subcategories. */
  includeSubcategories?: boolean;
  merchantId?: string;
  /** Tagged on the transaction or on one of its item lines. */
  tagId?: string;
  /** Has an item line for this product. */
  productId?: string;
  essential?: EssentialClass;
  ownership?: Ownership;
  /** Touches an account of this company. */
  companyId?: string;
  transferClass?: TransferClass;
  search?: string;
  limit?: number;
  offset?: number;
};

type ListRow = {
  id: string;
  kind: TransactionKind;
  date: string;
  amount_minor: number;
  currency: string;
  note: string | null;
  transfer_class: TransferClass | null;
  parent_id: string | null;
  category_id: string | null;
  cat_name: string | null;
  cat_icon: string | null;
  cat_color: string | null;
  merchant_name: string | null;
  item_count: number;
  tag_names: string | null;
  main_id: string | null;
  main_name: string | null;
  main_own: Ownership | null;
  main_cur: string | null;
  main_amount: number | null;
  from_id: string | null;
  from_name: string | null;
  from_own: Ownership | null;
  from_cur: string | null;
  from_amount: number | null;
  to_id: string | null;
  to_name: string | null;
  to_own: Ownership | null;
  to_cur: string | null;
  to_amount: number | null;
};

const ref = (
  id: string | null,
  name: string | null,
  own: Ownership | null,
  cur: string | null,
  amount: number | null,
): TxAccountRef | null =>
  id ? { id, name: name ?? '', ownership: own ?? 'personal', currency: cur ?? BASE_CURRENCY, amountMinor: amount ?? 0 } : null;

export async function listTransactions(db: Db, f: TransactionFilter = {}): Promise<TransactionListItem[]> {
  const where: string[] = ['t.deleted_at IS NULL'];
  const params: BindValue[] = [];
  if (f.from) {
    where.push('t.date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('t.date <= ?');
    params.push(f.to);
  }
  if (f.kinds?.length) {
    where.push(`t.kind IN (${f.kinds.map(() => '?').join(',')})`);
    params.push(...f.kinds);
  }
  if (f.categoryId === NO_CATEGORY) {
    where.push('t.category_id IS NULL');
  } else if (f.categoryId && f.includeSubcategories) {
    where.push('(t.category_id = ? OR c.parent_id = ?)');
    params.push(f.categoryId, f.categoryId);
  } else if (f.categoryId) {
    where.push('t.category_id = ?');
    params.push(f.categoryId);
  }
  if (f.tagId === NO_TAG) {
    where.push(`(NOT EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM purchase_items pi JOIN item_tags it ON it.item_id = pi.id WHERE pi.transaction_id = t.id))`);
  } else if (f.tagId) {
    where.push(`(EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ?)
      OR EXISTS (SELECT 1 FROM purchase_items pi JOIN item_tags it ON it.item_id = pi.id
                 WHERE pi.transaction_id = t.id AND it.tag_id = ?))`);
    params.push(f.tagId, f.tagId);
  }
  if (f.productId) {
    where.push('EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.transaction_id = t.id AND pi.product_id = ?)');
    params.push(f.productId);
  }
  if (f.essential) {
    where.push(
      f.essential === 'unclassified'
        ? 'COALESCE(c.essential, cp.essential) IS NULL'
        : 'COALESCE(c.essential, cp.essential) = ?',
    );
    if (f.essential !== 'unclassified') params.push(f.essential === 'essential' ? 1 : 0);
  }
  if (f.merchantId === NO_MERCHANT) {
    where.push('t.merchant_id IS NULL');
  } else if (f.merchantId) {
    where.push('t.merchant_id = ?');
    params.push(f.merchantId);
  }
  if (f.accountId) {
    where.push('EXISTS (SELECT 1 FROM postings px WHERE px.transaction_id = t.id AND px.account_id = ?)');
    params.push(f.accountId);
  }
  if (f.ownership) {
    where.push(
      'EXISTS (SELECT 1 FROM postings px JOIN accounts ax ON ax.id = px.account_id WHERE px.transaction_id = t.id AND ax.ownership = ?)',
    );
    params.push(f.ownership);
  }
  if (f.companyId) {
    where.push(
      'EXISTS (SELECT 1 FROM postings px JOIN accounts ax ON ax.id = px.account_id WHERE px.transaction_id = t.id AND ax.company_id = ?)',
    );
    params.push(f.companyId);
  }
  if (f.transferClass) {
    where.push('t.transfer_class = ?');
    params.push(f.transferClass);
  }
  if (f.search?.trim()) {
    const q = `%${f.search.trim()}%`;
    where.push(`(m.name LIKE ? OR t.note LIKE ? OR c.name LIKE ?
      OR EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.transaction_id = t.id AND pi.name LIKE ?))`);
    params.push(q, q, q, q);
  }
  params.push(f.limit ?? 100, f.offset ?? 0);

  const rows = await db.all<ListRow>(
    `SELECT t.id, t.kind, t.date, t.amount_minor, t.currency, t.note, t.transfer_class, t.parent_id, t.category_id,
       c.name AS cat_name, c.icon AS cat_icon, c.color AS cat_color, m.name AS merchant_name,
       (SELECT COUNT(*) FROM purchase_items pi WHERE pi.transaction_id = t.id) AS item_count,
       (SELECT GROUP_CONCAT(g.name, ', ') FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
        WHERE tt.transaction_id = t.id) AS tag_names,
       pm.account_id AS main_id, am.name AS main_name, am.ownership AS main_own, am.currency AS main_cur, pm.amount_minor AS main_amount,
       pf.account_id AS from_id, af.name AS from_name, af.ownership AS from_own, af.currency AS from_cur, pf.amount_minor AS from_amount,
       pt.account_id AS to_id, at2.name AS to_name, at2.ownership AS to_own, at2.currency AS to_cur, pt.amount_minor AS to_amount
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories cp ON cp.id = c.parent_id
     LEFT JOIN merchants m ON m.id = t.merchant_id
     LEFT JOIN postings pm ON pm.transaction_id = t.id AND pm.role = 'main'
     LEFT JOIN accounts am ON am.id = pm.account_id
     LEFT JOIN postings pf ON pf.transaction_id = t.id AND pf.role = 'from'
     LEFT JOIN accounts af ON af.id = pf.account_id
     LEFT JOIN postings pt ON pt.transaction_id = t.id AND pt.role = 'to'
     LEFT JOIN accounts at2 ON at2.id = pt.account_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    date: r.date,
    amountMinor: r.amount_minor,
    currency: r.currency,
    note: r.note,
    transferClass: r.transfer_class,
    parentId: r.parent_id,
    category: r.category_id
      ? { id: r.category_id, name: r.cat_name ?? '', icon: r.cat_icon, color: r.cat_color }
      : null,
    merchantName: r.merchant_name,
    itemCount: r.item_count,
    tagNames: r.tag_names,
    account: ref(r.main_id, r.main_name, r.main_own, r.main_cur, r.main_amount),
    from: ref(r.from_id, r.from_name, r.from_own, r.from_cur, r.from_amount),
    to: ref(r.to_id, r.to_name, r.to_own, r.to_cur, r.to_amount),
  }));
}

// ---------------------------------------------------------------------------
// Transaction detail

export type TransactionDetail = Transaction & {
  postings: TxAccountRef[];
  roles: Record<string, TxAccountRef>;
  items: PurchaseItem[];
  fees: { id: string; amountMinor: number; currency: string }[];
  merchantName: string | null;
  category: Category | null;
  instrument: { id: string; name: string; kind: string; last4: string | null } | null;
  reconciliationId: string | null;
  tags: Tag[];
};

export async function getTransaction(db: Db, id: string): Promise<TransactionDetail | null> {
  const t = await db.first<{
    id: string;
    kind: TransactionKind;
    date: string;
    amount_minor: number;
    currency: string;
    category_id: string | null;
    merchant_id: string | null;
    instrument_id: string | null;
    transfer_class: TransferClass | null;
    parent_id: string | null;
    note: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    merchant_name: string | null;
  }>(
    `SELECT t.*, m.name AS merchant_name FROM transactions t LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id],
  );
  if (!t) return null;

  const [postings, items, fees, category, instrument, rec, tags, itemTags] = await Promise.all([
    db.all<{ account_id: string; name: string; ownership: Ownership; currency: string; amount_minor: number; role: string }>(
      `SELECT p.account_id, a.name, a.ownership, a.currency, p.amount_minor, p.role
       FROM postings p JOIN accounts a ON a.id = p.account_id WHERE p.transaction_id = ? ORDER BY p.role`,
      [id],
    ),
    db.all<{
      id: string;
      product_id: string | null;
      line_kind: ItemLineKind;
      name: string;
      quantity_milli: number | null;
      unit: string | null;
      unit_price_minor: number | null;
      total_minor: number | null;
      notes: string | null;
      sort_order: number;
    }>('SELECT * FROM purchase_items WHERE transaction_id = ? ORDER BY sort_order', [id]),
    db.all<{ id: string; amount_minor: number; currency: string }>(
      'SELECT id, amount_minor, currency FROM transactions WHERE parent_id = ? AND deleted_at IS NULL',
      [id],
    ),
    t.category_id ? getCategory(db, t.category_id) : Promise.resolve(null),
    t.instrument_id
      ? db.first<{ id: string; name: string; kind: string; last4: string | null }>(
          'SELECT id, name, kind, last4 FROM payment_instruments WHERE id = ?',
          [t.instrument_id],
        )
      : Promise.resolve(null),
    db.first<{ id: string }>('SELECT id FROM reconciliations WHERE adjustment_transaction_id = ?', [id]),
    db.all<{ id: string; name: string; color: string | null; is_archived: number }>(
      `SELECT g.id, g.name, g.color, g.is_archived FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
       WHERE tt.transaction_id = ? ORDER BY g.name`,
      [id],
    ),
    db.all<{ item_id: string; tag_id: string }>(
      `SELECT it.item_id, it.tag_id FROM item_tags it JOIN purchase_items pi ON pi.id = it.item_id
       WHERE pi.transaction_id = ?`,
      [id],
    ),
  ]);

  const refs = postings.map((p) => ({
    id: p.account_id,
    name: p.name,
    ownership: p.ownership,
    currency: p.currency,
    amountMinor: p.amount_minor,
    role: p.role,
  }));

  return {
    id: t.id,
    kind: t.kind,
    date: t.date,
    amountMinor: t.amount_minor,
    currency: t.currency,
    categoryId: t.category_id,
    merchantId: t.merchant_id,
    instrumentId: t.instrument_id,
    transferClass: t.transfer_class,
    parentId: t.parent_id,
    note: t.note,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    merchantName: t.merchant_name,
    postings: refs,
    roles: Object.fromEntries(refs.map((r) => [r.role, r])),
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      lineKind: i.line_kind,
      name: i.name,
      quantityMilli: i.quantity_milli,
      unit: i.unit,
      unitPriceMinor: i.unit_price_minor,
      totalMinor: i.total_minor,
      notes: i.notes,
      sortOrder: i.sort_order,
      tagIds: itemTags.filter((x) => x.item_id === i.id).map((x) => x.tag_id),
    })),
    fees: fees.map((f) => ({ id: f.id, amountMinor: f.amount_minor, currency: f.currency })),
    category,
    instrument,
    reconciliationId: rec?.id ?? null,
    tags: tags.map((g) => ({ id: g.id, name: g.name, color: g.color, isArchived: g.is_archived === 1 })),
  };
}

// ---------------------------------------------------------------------------
// Period summary (cash flow)

export type CategoryTotal = {
  categoryId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  totalMinor: number;
  count: number;
};

export type PeriodSummary = {
  from: string;
  to: string;
  currency: string;
  incomeMinor: number;
  /** Part of income that came from the company as salary or dividends. */
  companyIncomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  /** null when there was no income. */
  savingsRate: number | null;
  adjustmentsMinor: number;
  expenseCount: number;
  activeSpendingDays: number;
  byCategory: CategoryTotal[];
  /** Currencies that had activity but no exchange rate (excluded from totals). */
  unconvertedCurrencies: string[];
};

/**
 * Income and spending for one ownership scope. Transfers are excluded, except
 * company → personal salary/dividend transfers, which are personal income.
 */
export async function periodSummary(
  db: Db,
  range: { from: string; to: string },
  ownership: Ownership = 'personal',
): Promise<PeriodSummary> {
  const rates = await latestRates(db, range.to < todayISO() ? range.to : todayISO());
  const unconverted = new Set<string>();
  const toBase = (minor: number, currency: string) => {
    const v = convertToBase(minor, currency, rates);
    if (v === null) {
      unconverted.add(currency);
      return 0;
    }
    return v;
  };

  const flows = await db.all<{ bucket: string; currency: string; total: number; n: number }>(
    `SELECT t.kind AS bucket, a.currency, SUM(p.amount_minor) AS total, COUNT(*) AS n
     FROM transactions t
     JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     JOIN accounts a ON a.id = p.account_id
     WHERE t.deleted_at IS NULL AND t.kind IN ('income','expense','adjustment')
       AND a.ownership = ? AND t.date BETWEEN ? AND ?
     GROUP BY t.kind, a.currency
     UNION ALL
     SELECT 'company_income' AS bucket, ta.currency, SUM(pt.amount_minor) AS total, COUNT(*) AS n
     FROM transactions t
     JOIN postings pt ON pt.transaction_id = t.id AND pt.role = 'to'
     JOIN accounts ta ON ta.id = pt.account_id
     JOIN postings pf ON pf.transaction_id = t.id AND pf.role = 'from'
     JOIN accounts af ON af.id = pf.account_id
     WHERE t.deleted_at IS NULL AND t.kind = 'transfer' AND ? = 'personal'
       AND ta.ownership = 'personal' AND af.ownership = 'business'
       AND t.transfer_class IN (${PERSONAL_INCOME_TRANSFER_CLASSES.map(() => '?').join(',')})
       AND t.date BETWEEN ? AND ?
     GROUP BY ta.currency`,
    [ownership, range.from, range.to, ownership, ...PERSONAL_INCOME_TRANSFER_CLASSES, range.from, range.to],
  );

  let income = 0;
  let companyIncome = 0;
  let expense = 0;
  let adjustments = 0;
  let expenseCount = 0;
  for (const f of flows) {
    const v = toBase(f.total, f.currency);
    if (f.bucket === 'income') income += v;
    else if (f.bucket === 'company_income') companyIncome += v;
    else if (f.bucket === 'expense') {
      expense += -v;
      expenseCount += f.n;
    } else if (f.bucket === 'adjustment') adjustments += v;
  }
  income += companyIncome;

  const cats = await db.all<{
    category_id: string | null;
    name: string | null;
    icon: string | null;
    color: string | null;
    currency: string;
    total: number;
    n: number;
  }>(
    `SELECT t.category_id, c.name, c.icon, c.color, a.currency, -SUM(p.amount_minor) AS total, COUNT(*) AS n
     FROM transactions t
     JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     JOIN accounts a ON a.id = p.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.kind = 'expense' AND a.ownership = ? AND t.date BETWEEN ? AND ?
     GROUP BY t.category_id, a.currency`,
    [ownership, range.from, range.to],
  );
  const byCat = new Map<string, CategoryTotal>();
  for (const c of cats) {
    const key = c.category_id ?? '__none__';
    const cur = byCat.get(key) ?? {
      categoryId: c.category_id,
      name: c.name ?? 'Uncategorised',
      icon: c.icon,
      color: c.color,
      totalMinor: 0,
      count: 0,
    };
    cur.totalMinor += toBase(c.total, c.currency);
    cur.count += c.n;
    byCat.set(key, cur);
  }

  const days = await db.first<{ n: number }>(
    `SELECT COUNT(DISTINCT t.date) AS n FROM transactions t
     JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     JOIN accounts a ON a.id = p.account_id
     WHERE t.deleted_at IS NULL AND t.kind = 'expense' AND a.ownership = ? AND t.date BETWEEN ? AND ?`,
    [ownership, range.from, range.to],
  );

  const net = income - expense;
  return {
    ...range,
    currency: BASE_CURRENCY,
    incomeMinor: income,
    companyIncomeMinor: companyIncome,
    expenseMinor: expense,
    netMinor: net,
    savingsRate: income > 0 ? net / income : null,
    adjustmentsMinor: adjustments,
    expenseCount,
    activeSpendingDays: days?.n ?? 0,
    byCategory: [...byCat.values()].sort((a, b) => b.totalMinor - a.totalMinor),
    unconvertedCurrencies: [...unconverted],
  };
}

// ---------------------------------------------------------------------------
// Categories, merchants, suggestions

export async function getCategory(db: Db, id: string): Promise<Category | null> {
  const r = await db.first<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id]);
  return r ? mapCategory(r) : null;
}

/** Categories ordered by how often they were used recently, then by default order. */
export async function listCategories(db: Db, kind: CategoryKind): Promise<Category[]> {
  const rows = await db.all<CategoryRow>(
    `SELECT c.* FROM categories c
     LEFT JOIN (
       SELECT category_id, COUNT(*) AS n FROM transactions
       WHERE deleted_at IS NULL AND parent_id IS NULL AND date >= date('now', '-90 days')
       GROUP BY category_id
     ) u ON u.category_id = c.id
     WHERE c.kind = ? AND c.is_archived = 0
     ORDER BY COALESCE(u.n, 0) DESC, c.sort_order`,
    [kind],
  );
  return rows.map(mapCategory);
}

export type MerchantSuggestion = Merchant & { useCount: number; lastUsed: string | null };

/** Merchants by recency of use; filtered by a case-insensitive prefix/substring. */
export async function suggestMerchants(db: Db, query = '', limit = 8): Promise<MerchantSuggestion[]> {
  const q = query.trim();
  const rows = await db.all<{
    id: string;
    name: string;
    default_category_id: string | null;
    n: number;
    last_used: string | null;
  }>(
    `SELECT m.id, m.name, m.default_category_id, COUNT(t.id) AS n, MAX(t.date) AS last_used
     FROM merchants m
     LEFT JOIN transactions t ON t.merchant_id = m.id AND t.deleted_at IS NULL
     WHERE m.is_archived = 0 ${q ? 'AND m.name LIKE ?' : ''}
     GROUP BY m.id
     ORDER BY ${q ? '(m.name LIKE ?) DESC,' : ''} last_used DESC, n DESC, m.name
     LIMIT ?`,
    q ? [`%${q}%`, `${q}%`, limit] : [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    defaultCategoryId: r.default_category_id,
    useCount: r.n,
    lastUsed: r.last_used,
  }));
}

export async function suggestProducts(db: Db, query = '', limit = 6): Promise<{ name: string; unit: string | null; lastUnitPriceMinor: number | null }[]> {
  const q = query.trim();
  const rows = await db.all<{ name: string; default_unit: string | null; last_price: number | null }>(
    `SELECT p.name, p.default_unit,
       (SELECT pi.unit_price_minor FROM purchase_items pi JOIN transactions t ON t.id = pi.transaction_id
        WHERE pi.product_id = p.id AND t.deleted_at IS NULL AND pi.unit_price_minor IS NOT NULL
        ORDER BY t.date DESC, pi.created_at DESC LIMIT 1) AS last_price
     FROM products p
     ${q ? 'WHERE p.name LIKE ?' : ''}
     ORDER BY (SELECT MAX(pi.created_at) FROM purchase_items pi WHERE pi.product_id = p.id) DESC
     LIMIT ?`,
    q ? [`%${q}%`, limit] : [limit],
  );
  return rows.map((r) => ({ name: r.name, unit: r.default_unit, lastUnitPriceMinor: r.last_price }));
}

// ---------------------------------------------------------------------------
// Settings

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const r = await db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return r?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

export const SETTING = {
  lastExpenseSource: 'last_expense_source',
  lastIncomeAccount: 'last_income_account',
} as const;
