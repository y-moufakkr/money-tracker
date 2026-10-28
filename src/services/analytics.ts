/**
 * Spending analytics. Personal expenses for a range are loaded once as
 * "facts" (converted to MAD with the same rates as the period summary), and
 * every breakdown is a pure function of them, so each rule is testable.
 *
 * Counting rules:
 * - A transaction contributes its paid amount once to any total.
 * - A tag gets the whole transaction when the transaction is tagged, otherwise
 *   the item lines tagged with it (capped at the amount paid). A transaction
 *   with several tags appears under each tag, but totals count it once.
 * - Product figures come from item lines only; quantities are compared only
 *   when units are compatible (see domain/units).
 */
import type { BindValue, Db } from '@/db/types';
import { addMonths, startOfMonth, todayISO, type DateRange } from '@/domain/dates';
import { BASE_CURRENCY, convertToBase } from '@/domain/money';
import type { ItemLineKind, Ownership } from '@/domain/types';
import {
  groupUnitLabel,
  normaliseQuantity,
  pricePerBaseUnit,
  unitGroup,
  type UnitGroup,
} from '@/domain/units';
import { latestRates } from './fx';
import { NO_CATEGORY, NO_MERCHANT, NO_TAG, type EssentialClass, type TransactionFilter } from './queries';

export type FactItem = {
  id: string;
  productId: string | null;
  productName: string | null;
  lineKind: ItemLineKind;
  /** MAD, null when the line has no amount. */
  totalMinor: number | null;
  quantityMilli: number | null;
  unit: string | null;
  tagIds: string[];
};

export type ExpenseFact = {
  id: string;
  date: string;
  /** Amount paid in MAD. */
  amountMinor: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  /** Top-level category (the category itself when it has no parent). */
  topId: string | null;
  topName: string | null;
  topColor: string | null;
  topIcon: string | null;
  essential: boolean | null;
  merchantId: string | null;
  merchantName: string | null;
  accountId: string;
  accountName: string;
  tagIds: string[];
  items: FactItem[];
};

export type ExpenseFacts = {
  range: DateRange;
  facts: ExpenseFact[];
  tags: Map<string, { name: string; color: string | null }>;
  /** Currencies without an exchange rate; their expenses are excluded. */
  unconvertedCurrencies: string[];
};

/**
 * Loads expenses of one ownership scope in a date range, with tags and items.
 * `companyId` narrows business facts to one company; `kind: 'income'` loads
 * income in the same shape (used by the company P&L).
 */
export async function loadExpenseFacts(
  db: Db,
  range: DateRange,
  ownership: Ownership = 'personal',
  opts: { companyId?: string; kind?: 'expense' | 'income' } = {},
): Promise<ExpenseFacts> {
  const today = todayISO();
  const rates = await latestRates(db, range.to < today ? range.to : today);
  let scope = `t.deleted_at IS NULL AND t.kind = ? AND a.ownership = ? AND t.date BETWEEN ? AND ?`;
  const scopeParams: BindValue[] = [opts.kind ?? 'expense', ownership, range.from, range.to];
  if (opts.companyId) {
    scope += ' AND a.company_id = ?';
    scopeParams.push(opts.companyId);
  }

  const [rows, txTags, items, itemTags, tags] = await Promise.all([
    db.all<{
      id: string;
      date: string;
      amount_minor: number;
      currency: string;
      category_id: string | null;
      c_name: string | null;
      c_color: string | null;
      c_icon: string | null;
      c_essential: number | null;
      p_id: string | null;
      p_name: string | null;
      p_color: string | null;
      p_icon: string | null;
      p_essential: number | null;
      merchant_id: string | null;
      merchant_name: string | null;
      account_id: string;
      account_name: string;
    }>(
      `SELECT t.id, t.date, t.amount_minor, a.currency, t.category_id,
         c.name AS c_name, c.color AS c_color, c.icon AS c_icon, c.essential AS c_essential,
         cp.id AS p_id, cp.name AS p_name, cp.color AS p_color, cp.icon AS p_icon, cp.essential AS p_essential,
         t.merchant_id, m.name AS merchant_name, a.id AS account_id, a.name AS account_name
       FROM transactions t
       JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
       JOIN accounts a ON a.id = p.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories cp ON cp.id = c.parent_id
       LEFT JOIN merchants m ON m.id = t.merchant_id
       WHERE ${scope}
       ORDER BY t.date, t.created_at`,
      scopeParams,
    ),
    db.all<{ transaction_id: string; tag_id: string }>(
      `SELECT tt.transaction_id, tt.tag_id FROM transaction_tags tt
       JOIN transactions t ON t.id = tt.transaction_id
       JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
       JOIN accounts a ON a.id = p.account_id
       WHERE ${scope}`,
      scopeParams,
    ),
    db.all<{
      id: string;
      transaction_id: string;
      product_id: string | null;
      product_name: string | null;
      line_kind: ItemLineKind;
      total_minor: number | null;
      quantity_milli: number | null;
      unit: string | null;
    }>(
      `SELECT pi.id, pi.transaction_id, pi.product_id, pr.name AS product_name, pi.line_kind, pi.total_minor,
         pi.quantity_milli, pi.unit
       FROM purchase_items pi
       LEFT JOIN products pr ON pr.id = pi.product_id
       JOIN transactions t ON t.id = pi.transaction_id
       JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
       JOIN accounts a ON a.id = p.account_id
       WHERE ${scope}
       ORDER BY pi.sort_order`,
      scopeParams,
    ),
    db.all<{ item_id: string; tag_id: string }>(
      `SELECT it.item_id, it.tag_id FROM item_tags it
       JOIN purchase_items pi ON pi.id = it.item_id
       JOIN transactions t ON t.id = pi.transaction_id
       JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
       JOIN accounts a ON a.id = p.account_id
       WHERE ${scope}`,
      scopeParams,
    ),
    db.all<{ id: string; name: string; color: string | null }>('SELECT id, name, color FROM tags'),
  ]);

  const unconverted = new Set<string>();
  const group = <T extends Record<K, string>, K extends string>(list: T[], key: K) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x[key], [...(m.get(x[key]) ?? []), x]);
    return m;
  };
  const tagsByTx = group(txTags, 'transaction_id');
  const itemsByTx = group(items, 'transaction_id');
  const tagsByItem = group(itemTags, 'item_id');

  const facts: ExpenseFact[] = [];
  for (const r of rows) {
    const amount = convertToBase(r.amount_minor, r.currency, rates);
    if (amount === null) {
      unconverted.add(r.currency);
      continue;
    }
    const top = r.p_id
      ? { id: r.p_id, name: r.p_name, color: r.p_color, icon: r.p_icon }
      : { id: r.category_id, name: r.c_name, color: r.c_color, icon: r.c_icon };
    const essential = r.c_essential ?? r.p_essential;
    facts.push({
      id: r.id,
      date: r.date,
      amountMinor: amount,
      categoryId: r.category_id,
      categoryName: r.c_name,
      categoryColor: r.c_color,
      categoryIcon: r.c_icon,
      topId: top.id,
      topName: top.name,
      topColor: top.color,
      topIcon: top.icon,
      essential: essential === null ? null : essential === 1,
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      accountId: r.account_id,
      accountName: r.account_name,
      tagIds: (tagsByTx.get(r.id) ?? []).map((x) => x.tag_id),
      items: (itemsByTx.get(r.id) ?? []).map((i) => ({
        id: i.id,
        productId: i.product_id,
        productName: i.product_name,
        lineKind: i.line_kind,
        totalMinor: i.total_minor === null ? null : convertToBase(i.total_minor, r.currency, rates),
        quantityMilli: i.quantity_milli,
        unit: i.unit,
        tagIds: (tagsByItem.get(i.id) ?? []).map((x) => x.tag_id),
      })),
    });
  }
  return {
    range,
    facts,
    tags: new Map(tags.map((t) => [t.id, { name: t.name, color: t.color }])),
    unconvertedCurrencies: [...unconverted],
  };
}

// ---------------------------------------------------------------------------
// Attribution

const signedLine = (i: FactItem) => (i.totalMinor ?? 0) * (i.lineKind === 'discount' ? -1 : 1);
const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));

/**
 * Part of an expense that belongs to any of `tagIds`: all of it when the
 * transaction carries one of the tags, else its matching item lines (each line
 * once, capped at the amount paid).
 */
export function tagAttribution(f: ExpenseFact, tagIds: Set<string>): number {
  if (f.tagIds.some((t) => tagIds.has(t))) return f.amountMinor;
  const sum = f.items.filter((i) => i.tagIds.some((t) => tagIds.has(t))).reduce((s, i) => s + signedLine(i), 0);
  return clamp(sum, f.amountMinor);
}

/** Item-line spending on one product within an expense, capped at the amount paid. */
export function productAttribution(f: ExpenseFact, productId: string): number {
  const sum = f.items.filter((i) => i.productId === productId).reduce((s, i) => s + signedLine(i), 0);
  return clamp(sum, f.amountMinor);
}

export function essentialClass(f: ExpenseFact): EssentialClass {
  return f.essential === null ? 'unclassified' : f.essential ? 'essential' : 'discretionary';
}

// ---------------------------------------------------------------------------
// Filters and breakdowns

export type AnalyticsFilter =
  | { kind: 'category'; id: string; label: string }
  | { kind: 'subcategory'; id: string; label: string }
  | { kind: 'tag'; id: string; label: string }
  | { kind: 'merchant'; id: string; label: string }
  | { kind: 'product'; id: string; label: string }
  | { kind: 'account'; id: string; label: string }
  | { kind: 'essential'; id: EssentialClass; label: string };

/** An expense with the part of it that is in scope of the current filter. */
export type ScopedFact = ExpenseFact & { scopedMinor: number };

export function applyFilter(facts: ExpenseFact[], filter: AnalyticsFilter | null): ScopedFact[] {
  const out: ScopedFact[] = [];
  for (const f of facts) {
    let scoped = f.amountMinor;
    if (filter) {
      switch (filter.kind) {
        case 'category':
          if (filter.id === NO_CATEGORY ? f.categoryId !== null : f.topId !== filter.id) scoped = 0;
          break;
        case 'subcategory':
          if ((f.categoryId ?? NO_CATEGORY) !== filter.id) scoped = 0;
          break;
        case 'tag':
          scoped =
            filter.id === NO_TAG
              ? f.tagIds.length > 0
                ? 0
                : f.amountMinor - clamp(f.items.filter((i) => i.tagIds.length > 0).reduce((s, i) => s + signedLine(i), 0), f.amountMinor)
              : tagAttribution(f, new Set([filter.id]));
          break;
        case 'merchant':
          if ((f.merchantId ?? NO_MERCHANT) !== filter.id) scoped = 0;
          break;
        case 'product':
          scoped = productAttribution(f, filter.id);
          break;
        case 'account':
          if (f.accountId !== filter.id) scoped = 0;
          break;
        case 'essential':
          if (essentialClass(f) !== filter.id) scoped = 0;
          break;
      }
    }
    if (scoped > 0) out.push({ ...f, scopedMinor: scoped });
  }
  return out;
}

export type Dimension = 'category' | 'subcategory' | 'tag' | 'merchant' | 'product' | 'account' | 'essential';

export type BreakdownRow = {
  key: string;
  label: string;
  color: string | null;
  icon: string | null;
  totalMinor: number;
  /** Number of transactions contributing. */
  count: number;
  /** Filter for the matching transactions, or null when they cannot be listed (e.g. "not itemised"). */
  drill: Partial<TransactionFilter> | null;
  /** Filter that narrows the analytics to this row. */
  filter: AnalyticsFilter | null;
};

export type Breakdown = {
  rows: BreakdownRow[];
  /** Σ in-scope amounts, each transaction once. */
  totalMinor: number;
  /** Rows overlap (tags): their sum exceeds the total. */
  overlapping: boolean;
};

const ESSENTIAL_LABEL: Record<EssentialClass, string> = {
  essential: 'Essential',
  discretionary: 'Discretionary',
  unclassified: 'Not classified',
};
const ESSENTIAL_COLOR: Record<EssentialClass, string> = {
  essential: '#0B7A64',
  discretionary: '#D0892A',
  unclassified: '#8B8F98',
};

export function breakdown(scoped: ScopedFact[], dimension: Dimension, tags: ExpenseFacts['tags']): Breakdown {
  const rows = new Map<string, BreakdownRow>();
  const add = (key: string, make: () => Omit<BreakdownRow, 'totalMinor' | 'count'>, amount: number) => {
    if (amount <= 0) return;
    const row = rows.get(key) ?? { ...make(), totalMinor: 0, count: 0 };
    row.totalMinor += amount;
    row.count += 1;
    rows.set(key, row);
  };
  const total = scoped.reduce((s, f) => s + f.scopedMinor, 0);

  for (const f of scoped) {
    switch (dimension) {
      case 'category': {
        const key = f.topId ?? NO_CATEGORY;
        add(
          key,
          () => ({
            key,
            label: f.topName ?? 'Uncategorised',
            color: f.topColor,
            icon: f.topIcon,
            drill: f.topId ? { categoryId: f.topId, includeSubcategories: true } : { categoryId: NO_CATEGORY },
            filter: { kind: 'category', id: key, label: f.topName ?? 'Uncategorised' },
          }),
          f.scopedMinor,
        );
        break;
      }
      case 'subcategory': {
        const key = f.categoryId ?? NO_CATEGORY;
        const label = f.categoryId
          ? f.topId !== f.categoryId
            ? `${f.topName} › ${f.categoryName}`
            : (f.categoryName ?? '')
          : 'Uncategorised';
        add(
          key,
          () => ({
            key,
            label,
            color: f.categoryColor,
            icon: f.categoryIcon,
            drill: { categoryId: key },
            filter: { kind: 'subcategory', id: key, label },
          }),
          f.scopedMinor,
        );
        break;
      }
      case 'tag': {
        const tagged = new Set([...f.tagIds, ...f.items.flatMap((i) => i.tagIds)]);
        for (const tagId of tagged) {
          const amount = Math.min(tagAttribution(f, new Set([tagId])), f.scopedMinor);
          const tag = tags.get(tagId);
          add(
            tagId,
            () => ({
              key: tagId,
              label: tag?.name ?? 'Tag',
              color: tag?.color ?? null,
              icon: 'sell',
              drill: { tagId },
              filter: { kind: 'tag', id: tagId, label: tag?.name ?? 'Tag' },
            }),
            amount,
          );
        }
        const covered = Math.min(tagAttribution(f, tagged), f.scopedMinor);
        add(
          NO_TAG,
          () => ({
            key: NO_TAG,
            label: 'Untagged',
            color: '#8B8F98',
            icon: 'label_off',
            drill: { tagId: NO_TAG },
            filter: { kind: 'tag', id: NO_TAG, label: 'Untagged' },
          }),
          f.scopedMinor - covered,
        );
        break;
      }
      case 'merchant': {
        const key = f.merchantId ?? NO_MERCHANT;
        add(
          key,
          () => ({
            key,
            label: f.merchantName ?? 'No merchant',
            color: null,
            icon: 'store',
            drill: { merchantId: key },
            filter: { kind: 'merchant', id: key, label: f.merchantName ?? 'No merchant' },
          }),
          f.scopedMinor,
        );
        break;
      }
      case 'product': {
        let itemised = 0;
        const products = new Map<string, { name: string; amount: number }>();
        for (const i of f.items) {
          if (!i.productId) continue;
          const p = products.get(i.productId) ?? { name: i.productName ?? 'Product', amount: 0 };
          p.amount += signedLine(i);
          products.set(i.productId, p);
        }
        for (const [productId, p] of products) {
          const amount = clamp(Math.min(p.amount, f.scopedMinor - itemised), f.scopedMinor);
          itemised += amount;
          add(
            productId,
            () => ({
              key: productId,
              label: p.name,
              color: null,
              icon: 'shopping_basket',
              drill: { productId },
              filter: { kind: 'product', id: productId, label: p.name },
            }),
            amount,
          );
        }
        add(
          '__unitemised__',
          () => ({
            key: '__unitemised__',
            label: 'Not itemised by product',
            color: '#8B8F98',
            icon: 'receipt_long',
            drill: null,
            filter: null,
          }),
          f.scopedMinor - itemised,
        );
        break;
      }
      case 'account':
        add(
          f.accountId,
          () => ({
            key: f.accountId,
            label: f.accountName,
            color: null,
            icon: 'account_balance_wallet',
            drill: { accountId: f.accountId },
            filter: { kind: 'account', id: f.accountId, label: f.accountName },
          }),
          f.scopedMinor,
        );
        break;
      case 'essential': {
        const cls = essentialClass(f);
        add(
          cls,
          () => ({
            key: cls,
            label: ESSENTIAL_LABEL[cls],
            color: ESSENTIAL_COLOR[cls],
            icon: cls === 'essential' ? 'verified' : cls === 'discretionary' ? 'local_mall' : 'help',
            drill: { essential: cls },
            filter: { kind: 'essential', id: cls, label: ESSENTIAL_LABEL[cls] },
          }),
          f.scopedMinor,
        );
        break;
      }
    }
  }
  const list = [...rows.values()].sort((a, b) => b.totalMinor - a.totalMinor);
  const sum = list.reduce((s, r) => s + r.totalMinor, 0);
  return { rows: list, totalMinor: total, overlapping: sum > total };
}

/**
 * Drill-down filter for a breakdown row combined with the active analytics filter.
 * `scope` defaults to personal expenses; the company P&L passes its own.
 */
export function drillFilter(
  range: DateRange,
  filter: AnalyticsFilter | null,
  row: Partial<TransactionFilter> | null,
  scope: Partial<TransactionFilter> = { kinds: ['expense'], ownership: 'personal' },
): TransactionFilter | null {
  if (row === null) return null;
  const base: TransactionFilter = { from: range.from, to: range.to, ...scope };
  if (filter) {
    switch (filter.kind) {
      case 'category':
        Object.assign(base, filter.id === NO_CATEGORY ? { categoryId: NO_CATEGORY } : { categoryId: filter.id, includeSubcategories: true });
        break;
      case 'subcategory':
        base.categoryId = filter.id;
        break;
      case 'tag':
        base.tagId = filter.id;
        break;
      case 'merchant':
        base.merchantId = filter.id;
        break;
      case 'product':
        base.productId = filter.id;
        break;
      case 'account':
        base.accountId = filter.id;
        break;
      case 'essential':
        base.essential = filter.id;
        break;
    }
  }
  return { ...base, ...row };
}

// ---------------------------------------------------------------------------
// Products: price history with unit normalisation

export type ProductLine = {
  itemId: string;
  transactionId: string;
  date: string;
  merchantId: string | null;
  merchantName: string | null;
  quantityMilli: number | null;
  unit: string | null;
  /** MAD; null when no amount was recorded. */
  totalMinor: number | null;
  /** Recorded price per recorded unit (MAD). */
  unitPriceMinor: number | null;
  group: UnitGroup;
  /** Normalised quantity (micro base units), null without a quantity. */
  quantityMicro: number | null;
  /** Price per base unit (kg, L, piece or the recorded unit), null when it cannot be derived. */
  normalisedPriceMinor: number | null;
};

/** Pure: derives the normalised quantity and price of one recorded line. Never guesses a missing value. */
export function normaliseLine(
  l: Omit<ProductLine, 'group' | 'quantityMicro' | 'normalisedPriceMinor'>,
): ProductLine {
  const group = unitGroup(l.unit);
  const quantityMicro = group === 'none' ? null : normaliseQuantity(l.quantityMilli, l.unit);
  let price: number | null = null;
  if (quantityMicro && l.totalMinor !== null) price = pricePerBaseUnit(l.totalMinor, quantityMicro);
  else if (group !== 'none' && l.unitPriceMinor !== null) {
    price = pricePerBaseUnit(l.unitPriceMinor, normaliseQuantity(1000, l.unit)!);
  }
  return { ...l, group, quantityMicro, normalisedPriceMinor: price };
}

export type PricePoint = { date: string; priceMinor: number; merchantName: string | null; transactionId: string };

export type UnitGroupStats = {
  group: UnitGroup;
  /** "kg", "L", "piece", or the recorded unit (e.g. "pack"). */
  unitLabel: string;
  lineCount: number;
  /** Σ normalised quantity of lines that recorded one. */
  quantityMicro: number;
  /** Σ amount of the lines that have both quantity and amount. */
  measuredSpentMinor: number;
  /** measuredSpent ÷ quantity, null without such lines. */
  averagePriceMinor: number | null;
  latest: PricePoint | null;
  cheapest: PricePoint | null;
  dearest: PricePoint | null;
  series: PricePoint[];
  byMerchant: { merchantId: string | null; merchantName: string; count: number; averagePriceMinor: number; lowestPriceMinor: number }[];
};

export type ProductStats = {
  lines: ProductLine[];
  totalSpentMinor: number;
  purchaseCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Mean days between purchases (distinct dates), null with fewer than two. */
  averageDaysBetween: number | null;
  /** One entry per group of comparable units, most used first. Groups are never mixed. */
  groups: UnitGroupStats[];
  /** Lines with no unit: counted in spending, but no price per unit is derived. */
  linesWithoutUnit: number;
};

export function productStats(lines: ProductLine[]): ProductStats {
  const sorted = [...lines].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dates = [...new Set(sorted.map((l) => l.date))];
  const groups = new Map<UnitGroup, ProductLine[]>();
  for (const l of sorted) if (l.group !== 'none') groups.set(l.group, [...(groups.get(l.group) ?? []), l]);

  const groupStats: UnitGroupStats[] = [...groups.entries()].map(([group, ls]) => {
    const priced = ls.filter((l) => l.normalisedPriceMinor !== null);
    const points = priced.map((l) => ({
      date: l.date,
      priceMinor: l.normalisedPriceMinor!,
      merchantName: l.merchantName,
      transactionId: l.transactionId,
    }));
    const measured = ls.filter((l) => l.quantityMicro !== null && l.totalMinor !== null);
    const qty = ls.reduce((s, l) => s + (l.quantityMicro ?? 0), 0);
    const measuredQty = measured.reduce((s, l) => s + l.quantityMicro!, 0);
    const measuredSpent = measured.reduce((s, l) => s + l.totalMinor!, 0);
    const merchants = new Map<
      string,
      { merchantId: string | null; merchantName: string; prices: number[]; spent: number; qty: number }
    >();
    for (const l of priced) {
      const key = l.merchantId ?? NO_MERCHANT;
      const m = merchants.get(key) ?? { merchantId: l.merchantId, merchantName: l.merchantName ?? 'No merchant', prices: [], spent: 0, qty: 0 };
      m.prices.push(l.normalisedPriceMinor!);
      if (l.quantityMicro !== null && l.totalMinor !== null) {
        m.spent += l.totalMinor;
        m.qty += l.quantityMicro;
      }
      merchants.set(key, m);
    }
    const pick = (better: (a: PricePoint, b: PricePoint) => boolean) =>
      points.reduce<PricePoint | null>((best, p) => (best === null || better(p, best) ? p : best), null);
    return {
      group,
      unitLabel: groupUnitLabel(group) ?? '',
      lineCount: ls.length,
      quantityMicro: qty,
      measuredSpentMinor: measuredSpent,
      averagePriceMinor: measuredQty > 0 ? pricePerBaseUnit(measuredSpent, measuredQty) : null,
      latest: points.length ? points[points.length - 1] : null,
      cheapest: pick((a, b) => a.priceMinor < b.priceMinor),
      dearest: pick((a, b) => a.priceMinor > b.priceMinor),
      series: points,
      byMerchant: [...merchants.values()]
        .map((m) => ({
          merchantId: m.merchantId,
          merchantName: m.merchantName,
          count: m.prices.length,
          // Weighted like the overall average (spent ÷ quantity); a plain mean only when no line has a quantity.
          averagePriceMinor:
            m.qty > 0 ? pricePerBaseUnit(m.spent, m.qty) : Math.round(m.prices.reduce((s, p) => s + p, 0) / m.prices.length),
          lowestPriceMinor: Math.min(...m.prices),
        }))
        .sort((a, b) => a.averagePriceMinor - b.averagePriceMinor),
    };
  });
  groupStats.sort((a, b) => b.lineCount - a.lineCount);

  let gaps = 0;
  for (let i = 1; i < dates.length; i++) {
    gaps += (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000;
  }
  return {
    lines: sorted,
    totalSpentMinor: sorted.reduce((s, l) => s + (l.totalMinor ?? 0), 0),
    purchaseCount: new Set(sorted.map((l) => l.transactionId)).size,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    averageDaysBetween: dates.length > 1 ? Math.round(gaps / (dates.length - 1)) : null,
    groups: groupStats,
    linesWithoutUnit: sorted.filter((l) => l.group === 'none').length,
  };
}

/** Recorded item lines for products (personal expenses), converted to MAD with today's rates. */
export async function loadProductLines(
  db: Db,
  opts: { productId?: string; merchantId?: string; range?: DateRange } = {},
): Promise<(ProductLine & { productId: string; productName: string })[]> {
  const rates = await latestRates(db, todayISO());
  const where = ["t.deleted_at IS NULL", "t.kind = 'expense'", "a.ownership = 'personal'", "pi.line_kind = 'product'", 'pi.product_id IS NOT NULL'];
  const params: BindValue[] = [];
  if (opts.productId) {
    where.push('pi.product_id = ?');
    params.push(opts.productId);
  }
  if (opts.merchantId) {
    where.push('t.merchant_id = ?');
    params.push(opts.merchantId);
  }
  if (opts.range) {
    where.push('t.date BETWEEN ? AND ?');
    params.push(opts.range.from, opts.range.to);
  }
  const rows = await db.all<{
    item_id: string;
    transaction_id: string;
    date: string;
    merchant_id: string | null;
    merchant_name: string | null;
    quantity_milli: number | null;
    unit: string | null;
    total_minor: number | null;
    unit_price_minor: number | null;
    currency: string;
    product_id: string;
    product_name: string;
    estimated: number;
  }>(
    `SELECT pi.id AS item_id, t.id AS transaction_id, t.date, t.merchant_id, m.name AS merchant_name, pi.quantity_milli,
       pi.unit, pi.total_minor, pi.unit_price_minor, a.currency, pi.product_id, pr.name AS product_name, pi.estimated
     FROM purchase_items pi
     JOIN products pr ON pr.id = pi.product_id
     JOIN transactions t ON t.id = pi.transaction_id
     JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     JOIN accounts a ON a.id = p.account_id
     LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.date, pi.created_at`,
    params,
  );
  const conv = (v: number | null, cur: string) => (v === null ? null : convertToBase(v, cur, rates));
  return rows
    .filter((r) => r.currency === BASE_CURRENCY || rates.has(r.currency))
    .map((r) => ({
      ...normaliseLine({
        itemId: r.item_id,
        transactionId: r.transaction_id,
        date: r.date,
        merchantId: r.merchant_id,
        merchantName: r.merchant_name,
        // An estimated total is spending, not a price: no quantity or unit price is paired with it.
        quantityMilli: r.estimated ? null : r.quantity_milli,
        unit: r.unit,
        totalMinor: conv(r.total_minor, r.currency),
        unitPriceMinor: r.estimated ? null : conv(r.unit_price_minor, r.currency),
      }),
      productId: r.product_id,
      productName: r.product_name,
    }));
}

export type ProductSummary = {
  id: string;
  name: string;
  defaultUnit: string | null;
  purchaseCount: number;
  totalSpentMinor: number;
  lastDate: string | null;
  /** Latest normalised price in the most used unit group. */
  latestPrice: { priceMinor: number; unitLabel: string } | null;
};

export async function listProducts(db: Db, search = ''): Promise<ProductSummary[]> {
  const q = search.trim();
  const [products, lines] = await Promise.all([
    db.all<{ id: string; name: string; default_unit: string | null }>(
      `SELECT id, name, default_unit FROM products ${q ? 'WHERE name LIKE ?' : ''} ORDER BY name`,
      q ? [`%${q}%`] : [],
    ),
    loadProductLines(db),
  ]);
  const byProduct = new Map<string, ProductLine[]>();
  for (const l of lines) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l]);
  return products
    .map((p) => {
      const stats = productStats(byProduct.get(p.id) ?? []);
      const g = stats.groups[0];
      return {
        id: p.id,
        name: p.name,
        defaultUnit: p.default_unit,
        purchaseCount: stats.purchaseCount,
        totalSpentMinor: stats.totalSpentMinor,
        lastDate: stats.lastDate,
        latestPrice: g?.latest ? { priceMinor: g.latest.priceMinor, unitLabel: g.unitLabel } : null,
      };
    })
    .sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || a.name.localeCompare(b.name));
}

export async function productDetail(db: Db, productId: string) {
  const product = await db.first<{ id: string; name: string; default_unit: string | null }>(
    'SELECT id, name, default_unit FROM products WHERE id = ?',
    [productId],
  );
  if (!product) return null;
  const lines = await loadProductLines(db, { productId });
  return { id: product.id, name: product.name, defaultUnit: product.default_unit, stats: productStats(lines) };
}

// ---------------------------------------------------------------------------
// Merchants

export type MerchantSummary = {
  id: string;
  name: string;
  isArchived: boolean;
  totalMinor: number;
  visits: number;
  averageTicketMinor: number | null;
  lastVisit: string | null;
  thisMonthMinor: number;
};

const ALL_TIME = (today: string): DateRange => ({ from: '0000-01-01', to: today });

export async function listMerchants(db: Db, search = ''): Promise<MerchantSummary[]> {
  const today = todayISO();
  const q = search.trim();
  const [merchants, facts] = await Promise.all([
    db.all<{ id: string; name: string; is_archived: number }>(
      `SELECT id, name, is_archived FROM merchants ${q ? 'WHERE name LIKE ?' : ''} ORDER BY name`,
      q ? [`%${q}%`] : [],
    ),
    loadExpenseFacts(db, ALL_TIME(today)),
  ]);
  const monthStart = startOfMonth(today);
  return merchants
    .map((m) => {
      const own = facts.facts.filter((f) => f.merchantId === m.id);
      const total = own.reduce((s, f) => s + f.amountMinor, 0);
      return {
        id: m.id,
        name: m.name,
        isArchived: m.is_archived === 1,
        totalMinor: total,
        visits: own.length,
        averageTicketMinor: own.length ? Math.round(total / own.length) : null,
        lastVisit: own.length ? own[own.length - 1].date : null,
        thisMonthMinor: own.filter((f) => f.date >= monthStart).reduce((s, f) => s + f.amountMinor, 0),
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name));
}

export async function merchantDetail(db: Db, merchantId: string) {
  const today = todayISO();
  const m = await db.first<{ id: string; name: string; is_archived: number; default_category_id: string | null }>(
    'SELECT id, name, is_archived, default_category_id FROM merchants WHERE id = ?',
    [merchantId],
  );
  if (!m) return null;
  const [facts, lines] = await Promise.all([loadExpenseFacts(db, ALL_TIME(today)), loadProductLines(db, { merchantId })]);
  const own = facts.facts.filter((f) => f.merchantId === merchantId);
  const total = own.reduce((s, f) => s + f.amountMinor, 0);

  const months: { month: string; totalMinor: number; visits: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const month = addMonths(startOfMonth(today), -i).slice(0, 7);
    const inMonth = own.filter((f) => f.date.startsWith(month));
    months.push({ month: `${month}-01`, totalMinor: inMonth.reduce((s, f) => s + f.amountMinor, 0), visits: inMonth.length });
  }

  const byProduct = new Map<string, { name: string; lines: ProductLine[] }>();
  for (const l of lines) {
    const p = byProduct.get(l.productId) ?? { name: l.productName, lines: [] };
    p.lines.push(l);
    byProduct.set(l.productId, p);
  }
  const products = [...byProduct.entries()]
    .map(([id, p]) => {
      const stats = productStats(p.lines);
      const g = stats.groups[0];
      return {
        id,
        name: p.name,
        purchaseCount: stats.purchaseCount,
        spentMinor: stats.totalSpentMinor,
        latestPrice: g?.latest ? { priceMinor: g.latest.priceMinor, unitLabel: g.unitLabel, date: g.latest.date } : null,
      };
    })
    .sort((a, b) => b.purchaseCount - a.purchaseCount);

  const scoped = applyFilter(own, null);
  return {
    id: m.id,
    name: m.name,
    isArchived: m.is_archived === 1,
    totalMinor: total,
    visits: own.length,
    averageTicketMinor: own.length ? Math.round(total / own.length) : null,
    firstVisit: own[0]?.date ?? null,
    lastVisit: own.length ? own[own.length - 1].date : null,
    months,
    categories: breakdown(scoped, 'category', facts.tags).rows,
    products,
  };
}
