import { router } from 'expo-router';
import { View } from 'react-native';

import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import type { Occurrence, OccurrenceRef } from '@/services/recurring';
import { Amount, ListItem, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

/** Route params that identify one occurrence (a rule's due date, or a stored expected payment). */
export function occurrenceHref(ref: OccurrenceRef): string {
  return 'expectedId' in ref ? `/bills/occurrence?expected=${ref.expectedId}` : `/bills/occurrence?rule=${ref.ruleId}&due=${ref.dueDate}`;
}

export function dueLabel(o: Occurrence): string {
  if (o.status === 'paid') return `Paid${o.paidDate ? ` ${formatDateLabel(o.paidDate)}` : ''}`;
  if (o.status === 'skipped') return 'Skipped';
  if (o.overdue) return `Overdue · was due ${formatDateLabel(o.dueDate)}`;
  if (o.daysUntil === 0) return 'Due today';
  if (o.daysUntil === 1) return 'Due tomorrow';
  return `Due ${formatDateLabel(o.dueDate)} · in ${o.daysUntil} days`;
}

/** One expected payment or income: amount, due state, location. Opens its pay/link/skip screen. */
export function OccurrenceRow({ o, showName = true }: { o: Occurrence; showName?: boolean }) {
  const c = useColors();
  const income = o.direction === 'income';
  const stateColor = o.status === 'paid' ? c.positive : o.overdue ? c.negative : o.dueSoon ? c.warning : c.textMuted;
  return (
    <ListItem
      icon={o.debtId ? 'handshake' : (o.categoryIcon ?? (income ? 'add_card' : 'event_repeat'))}
      iconColor={o.categoryColor ?? (income ? c.positive : c.primary)}
      title={showName ? o.name : formatDateLabel(o.dueDate)}
      subtitle={
        <Text variant="caption" color={stateColor} numberOfLines={1}>
          {dueLabel(o)}
          <Text variant="caption" tone="muted">
            {` · ${o.accountName}`}
            {income ? ' · expected income' : ''}
          </Text>
        </Text>
      }
      right={
        <View style={{ alignItems: 'flex-end' }}>
          <Amount
            minor={o.status === 'paid' && o.paidMinor !== null ? o.paidMinor : o.amountMinor}
            currency={o.currency}
            color={o.status === 'skipped' ? c.textFaint : income ? c.positive : undefined}
          />
          {o.status === 'paid' && o.paidMinor !== null && o.paidMinor !== o.amountMinor && (
            <Text variant="caption" tone="faint">
              expected {formatMoney(o.amountMinor, o.currency)}
            </Text>
          )}
          {o.status === 'pending' && o.adjusted && (
            <Text variant="caption" tone="faint">
              adjusted
            </Text>
          )}
        </View>
      }
      onPress={() => router.push(occurrenceHref(o.ref))}
    />
  );
}
