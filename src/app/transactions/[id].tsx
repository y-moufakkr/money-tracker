import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, View } from 'react-native';

import { formatDateLabel } from '@/domain/dates';
import { formatMoney, formatQuantity } from '@/domain/money';
import { transferClassLabel } from '@/domain/types';
import { useLedgerMutation, useTags, useTransaction } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { deleteTransaction } from '@/services/ledger';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconBadge, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 6, alignItems: 'flex-start' }}>
      <Text tone="muted">{label}</Text>
      <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
        {typeof children === 'string' ? <Text style={{ textAlign: 'right' }}>{children}</Text> : children}
      </View>
    </Row>
  );
}

export default function TransactionScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, isLoading } = useTransaction(id);
  const remove = useLedgerMutation((db, txId: string) => deleteTransaction(db, txId));
  const tagNames = new Map((useTags(true).data ?? []).map((g) => [g.id, g.name]));

  if (isLoading) return <Loading />;
  if (!t) return <EmptyState icon="error" title="Transaction not found" message="It may have been deleted." />;

  const title =
    t.kind === 'transfer'
      ? transferClassLabel(t.transferClass)
      : t.kind === 'adjustment'
        ? 'Balance adjustment'
        : (t.merchantName ?? t.category?.name ?? (t.kind === 'income' ? 'Income' : 'Expense'));
  const signed = t.kind === 'expense' ? -t.amountMinor : t.kind === 'adjustment' ? (t.roles.main?.amountMinor ?? 0) : t.amountMinor;
  const color = t.kind === 'income' ? c.positive : t.kind === 'expense' ? c.text : t.kind === 'adjustment' ? c.warning : c.primary;
  const isFee = !!t.parentId;
  const editHref =
    t.kind === 'expense' ? `/entry/expense?id=${t.id}` : t.kind === 'income' ? `/entry/income?id=${t.id}` : t.kind === 'transfer' ? `/entry/transfer?id=${t.id}` : null;

  const confirmDelete = () =>
    Alert.alert(
      'Delete this transaction?',
      t.kind === 'adjustment'
        ? 'The balance check it came from will be re-opened for investigation.'
        : t.fees.length
          ? 'Its transfer fee will be deleted too. Balances are recalculated.'
          : 'Balances are recalculated immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(t.id, { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Not possible', e.message) }) },
      ],
    );

  const itemsTotal = t.items.reduce((s, i) => s + (i.totalMinor ?? 0) * (i.lineKind === 'discount' ? -1 : 1), 0);

  return (
    <>
      <Stack.Screen options={{ title: t.kind === 'transfer' ? 'Transfer' : t.kind === 'income' ? 'Income' : t.kind === 'adjustment' ? 'Adjustment' : 'Expense' }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.lg }}>
          <IconBadge
            icon={t.kind === 'transfer' ? 'swap_horiz' : t.kind === 'adjustment' ? 'balance' : (t.category?.icon ?? 'receipt_long')}
            color={t.category?.color ?? color}
            size={56}
          />
          <Text variant="heading">{title}</Text>
          <Amount minor={signed} currency={t.currency} variant="display" sign={t.kind === 'transfer' ? 'never' : 'always'} color={color} />
          <Text tone="muted">{formatDateLabel(t.date)}</Text>
        </View>

        <Card>
          {t.kind === 'transfer' ? (
            <>
              <Line label="From">{`${t.roles.from?.name ?? '—'}`}</Line>
              <Line label="To">{`${t.roles.to?.name ?? '—'}`}</Line>
              {t.roles.to && t.roles.to.currency !== t.currency && (
                <Line label="Received">{formatMoney(t.roles.to.amountMinor, t.roles.to.currency)}</Line>
              )}
              {t.fees.map((f) => (
                <Line key={f.id} label="Fee">
                  {formatMoney(f.amountMinor, f.currency)}
                </Line>
              ))}
              {t.transferClass && t.transferClass !== 'internal' && <Line label="Classification">{transferClassLabel(t.transferClass)}</Line>}
            </>
          ) : (
            <>
              <Line label={t.kind === 'income' ? 'Received into' : t.kind === 'adjustment' ? 'Location' : 'Paid from'}>
                {`${t.roles.main?.name ?? '—'}${t.roles.main?.ownership === 'business' ? ' (company)' : ''}`}
              </Line>
              {t.instrument && <Line label="Card">{`${t.instrument.name}${t.instrument.last4 ? ` · ${t.instrument.last4}` : ''}`}</Line>}
              {t.category && <Line label="Category">{t.category.name}</Line>}
              {t.merchantName && <Line label={t.kind === 'income' ? 'From' : 'Merchant'}>{t.merchantName}</Line>}
            </>
          )}
          {t.tags.length > 0 && <Line label="Tags">{t.tags.map((g) => `#${g.name}`).join(' ')}</Line>}
          {t.note && <Line label="Note">{t.note}</Line>}
        </Card>

        {isFee && (
          <View style={{ marginTop: space.md }}>
            <Banner tone="info">This is the fee of a transfer. Open the transfer to change or delete it.</Banner>
            <Button kind="ghost" label="Open transfer" onPress={() => router.replace(`/transactions/${t.parentId}`)} />
          </View>
        )}
        {t.kind === 'adjustment' && (
          <View style={{ marginTop: space.md }}>
            <Banner tone="warning">
              Recorded from a balance check to match the actual balance. Not counted as income or spending.
            </Banner>
          </View>
        )}

        {t.items.length > 0 && (
          <>
            <SectionHeader title={`Items · ${t.items.length}`} />
            <Card padded={false}>
              {t.items.map((i, idx) => (
                <View key={i.id}>
                  {idx > 0 && <Divider inset={16} />}
                  <Row style={{ padding: space.md, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="bodyStrong"
                        color={i.productId ? c.primary : undefined}
                        onPress={i.productId ? () => router.push(`/products/${i.productId}`) : undefined}>
                        {i.name}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {[
                          i.lineKind !== 'product' ? i.lineKind : null,
                          i.quantityMilli !== null ? `${formatQuantity(i.quantityMilli)}${i.unit ? ` ${i.unit}` : ''}` : null,
                          i.unitPriceMinor !== null ? `× ${formatMoney(i.unitPriceMinor, t.currency)}${i.unit ? `/${i.unit}` : ''}` : null,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        {i.tagIds.length > 0 ? ` · ${i.tagIds.map((id) => `#${tagNames.get(id) ?? '?'}`).join(' ')}` : ''}
                      </Text>
                    </View>
                    <Text color={i.lineKind === 'discount' ? c.positive : undefined}>
                      {i.totalMinor === null ? '—' : `${i.lineKind === 'discount' ? '−' : ''}${formatMoney(i.totalMinor, t.currency)}`}
                    </Text>
                  </Row>
                </View>
              ))}
            </Card>
            {itemsTotal !== t.amountMinor && (
              <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
                Items add up to {formatMoney(itemsTotal, t.currency)}; {formatMoney(t.amountMinor, t.currency)} was paid. Balances always use the amount paid.
              </Text>
            )}
          </>
        )}

        <View style={{ marginTop: space.xl, gap: space.md }}>
          {editHref && !isFee && <Button kind="secondary" icon="edit" label="Edit" onPress={() => router.push(editHref)} />}
          {!isFee && <Button kind="danger" icon="delete" label="Delete" onPress={confirmDelete} loading={remove.isPending} />}
        </View>
      </ScrollView>
    </>
  );
}
