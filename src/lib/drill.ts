import { router } from 'expo-router';

import type { Ownership, TransactionKind } from '@/domain/types';
import type { EssentialClass, TransactionFilter } from '@/services/queries';

/** Route params understood by the Activity tab. All strings, as Expo Router requires. */
export type DrillParams = {
  label?: string;
  from?: string;
  to?: string;
  categoryId?: string;
  sub?: string;
  tagId?: string;
  merchantId?: string;
  productId?: string;
  accountId?: string;
  essential?: string;
  kinds?: string;
  ownership?: string;
};

const DRILL_KEYS: (keyof DrillParams)[] = [
  'label', 'from', 'to', 'categoryId', 'sub', 'tagId', 'merchantId', 'productId', 'accountId', 'essential', 'kinds', 'ownership',
];

export function encodeDrill(f: TransactionFilter, label: string): DrillParams {
  const p: DrillParams = { label };
  if (f.from) p.from = f.from;
  if (f.to) p.to = f.to;
  if (f.categoryId) p.categoryId = f.categoryId;
  if (f.includeSubcategories) p.sub = '1';
  if (f.tagId) p.tagId = f.tagId;
  if (f.merchantId) p.merchantId = f.merchantId;
  if (f.productId) p.productId = f.productId;
  if (f.accountId) p.accountId = f.accountId;
  if (f.essential) p.essential = f.essential;
  if (f.kinds?.length) p.kinds = f.kinds.join(',');
  if (f.ownership) p.ownership = f.ownership;
  return p;
}

/** Null when the params carry no drill-down filter. */
export function decodeDrill(p: DrillParams): TransactionFilter | null {
  const f: TransactionFilter = {
    from: p.from || undefined,
    to: p.to || undefined,
    categoryId: p.categoryId || undefined,
    includeSubcategories: p.sub === '1' || undefined,
    tagId: p.tagId || undefined,
    merchantId: p.merchantId || undefined,
    productId: p.productId || undefined,
    accountId: p.accountId || undefined,
    essential: (p.essential || undefined) as EssentialClass | undefined,
    kinds: p.kinds ? (p.kinds.split(',') as TransactionKind[]) : undefined,
    ownership: (p.ownership || undefined) as Ownership | undefined,
  };
  return Object.values(f).some((v) => v !== undefined) ? f : null;
}

/** Params that clear every drill-down filter. */
export const CLEAR_DRILL = Object.fromEntries(DRILL_KEYS.map((k) => [k, undefined])) as Record<keyof DrillParams, undefined>;

/** Opens Activity showing exactly the transactions behind a figure. */
export function openTransactions(filter: TransactionFilter, label: string) {
  router.push({ pathname: '/transactions', params: encodeDrill(filter, label) });
}
