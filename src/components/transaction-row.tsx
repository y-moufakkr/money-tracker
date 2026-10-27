import { router } from 'expo-router';
import { View } from 'react-native';

import { formatMoney } from '@/domain/money';
import { transferClassLabel } from '@/domain/types';
import type { TransactionListItem } from '@/services/queries';
import { Amount, ListItem, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

function describe(t: TransactionListItem) {
  switch (t.kind) {
    case 'expense':
      return {
        icon: t.category?.icon ?? 'shopping_bag',
        color: t.category?.color ?? '#8B8F98',
        title: t.merchantName ?? t.category?.name ?? 'Expense',
        subtitle: [t.merchantName ? t.category?.name : null, t.account?.name].filter(Boolean).join(' · '),
      };
    case 'income':
      return {
        icon: t.category?.icon ?? 'add_card',
        color: t.category?.color ?? '#13804B',
        title: t.merchantName ?? t.category?.name ?? 'Income',
        subtitle: [t.merchantName ? t.category?.name : null, t.account?.name].filter(Boolean).join(' · '),
      };
    case 'transfer':
      return {
        icon: t.transferClass && t.transferClass !== 'internal' ? 'business_center' : 'swap_horiz',
        color: t.transferClass && t.transferClass !== 'internal' ? '#4B44D6' : '#3E7BD6',
        title: transferClassLabel(t.transferClass),
        subtitle: `${t.from?.name ?? '?'} → ${t.to?.name ?? '?'}`,
      };
    case 'adjustment':
      return {
        icon: 'balance',
        color: '#A85A06',
        title: 'Balance adjustment',
        subtitle: t.account?.name ?? '',
      };
  }
}

/**
 * One transaction. With `accountId`, the amount is shown from that location's
 * point of view (e.g. a transfer out shows as negative).
 */
export function TransactionRow({
  t,
  accountId,
  balanceAfterMinor,
}: {
  t: TransactionListItem;
  accountId?: string;
  /** Running balance of `accountId` after this transaction. */
  balanceAfterMinor?: number;
}) {
  const c = useColors();
  const d = describe(t);
  const business = [t.account, t.from, t.to].some((a) => a?.ownership === 'business');

  let minor: number;
  let currency = t.currency;
  let colored: boolean | 'negative-only' = 'negative-only';
  if (accountId) {
    const ref = [t.account, t.from, t.to].find((a) => a?.id === accountId);
    minor = ref?.amountMinor ?? 0;
    currency = ref?.currency ?? t.currency;
    colored = true;
  } else if (t.kind === 'expense') {
    minor = -t.amountMinor;
  } else if (t.kind === 'income') {
    minor = t.amountMinor;
    colored = true;
  } else if (t.kind === 'adjustment') {
    minor = t.account?.amountMinor ?? 0;
    colored = true;
  } else {
    minor = t.amountMinor;
    colored = false;
  }

  return (
    <ListItem
      icon={d.icon}
      iconColor={d.color}
      title={d.title}
      subtitle={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {business && (
            <View style={{ backgroundColor: c.businessSoft, borderRadius: 4, paddingHorizontal: 5 }}>
              <Text variant="caption" color={c.business}>
                Company
              </Text>
            </View>
          )}
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {d.subtitle}
            {t.itemCount > 0 ? ` · ${t.itemCount} item${t.itemCount > 1 ? 's' : ''}` : ''}
            {t.tagNames ? ` · #${t.tagNames.split(', ').join(' #')}` : ''}
          </Text>
        </View>
      }
      right={
        <View style={{ alignItems: 'flex-end' }}>
          <Amount
            minor={minor}
            currency={currency}
            sign={t.kind === 'transfer' && !accountId ? 'never' : 'always'}
            colored={colored}
          />
          {balanceAfterMinor !== undefined && (
            <Text variant="caption" tone="faint" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMoney(balanceAfterMinor, currency)}
            </Text>
          )}
        </View>
      }
      onPress={() => router.push(`/transactions/${t.parentId ?? t.id}`)}
    />
  );
}
