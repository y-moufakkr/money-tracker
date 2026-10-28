import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { formatDateLabel } from '@/domain/dates';
import { formatMoney, formatQuantity } from '@/domain/money';
import { transferClassLabel } from '@/domain/types';
import { PhotoThumb } from '@/components/receipt-photos';
import { useAttachments } from '@/hooks/attachments';
import { useLedgerMutation, useTags, useTransaction, useTransactionLinks, useTransactionPlans } from '@/hooks/data';
import { attachmentStore } from '@/lib/attachment-store';
import { confirmAction, notify } from '@/lib/confirm';
import { closeScreen } from '@/lib/navigation';
import { deleteTransactionWithFiles } from '@/services/attachments';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconBadge, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
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
  const remove = useLedgerMutation((db, txId: string) => deleteTransactionWithFiles(db, attachmentStore, txId));
  const photos = useAttachments(id).data ?? [];
  const tagNames = new Map((useTags(true).data ?? []).map((g) => [g.id, g.name]));
  const links = useTransactionLinks(id).data;
  const plans = useTransactionPlans(id).data;
  // Null-safe locals for closures (React Compiler hoists property reads out of guards).
  const planDebtId = plans?.debt?.id ?? null;
  const planRuleId = plans?.expected?.ruleId ?? null;

  if (isLoading) return <Loading />;
  if (!t) return <EmptyState icon="error" title="Transaction not found" message="It may have been deleted." />;

  const title =
    t.kind === 'transfer'
      ? transferClassLabel(t.transferClass)
      : t.kind === 'adjustment'
        ? 'Balance adjustment'
        : t.kind === 'debt'
          ? (t.note ?? 'Loan')
          : (t.merchantName ?? t.category?.name ?? (t.kind === 'income' ? 'Income' : 'Expense'));
  const signed =
    t.kind === 'expense' ? -t.amountMinor : t.kind === 'adjustment' || t.kind === 'debt' ? (t.roles.main?.amountMinor ?? 0) : t.amountMinor;
  const color =
    t.kind === 'income' ? c.positive : t.kind === 'expense' || t.kind === 'debt' ? c.text : t.kind === 'adjustment' ? c.warning : c.primary;
  const isFee = !!t.parentId;
  const editHref =
    t.kind === 'expense' ? `/entry/expense?id=${t.id}` : t.kind === 'income' ? `/entry/income?id=${t.id}` : t.kind === 'transfer' ? `/entry/transfer?id=${t.id}` : null;

  const photoNote = photos.length ? ` ${photos.length === 1 ? 'Its receipt photo is' : 'Its receipt photos are'} deleted too.` : '';
  const confirmDelete = () =>
    confirmAction(
      'Delete this transaction?',
      (t.kind === 'adjustment'
        ? 'The balance check it came from will be re-opened for investigation.'
        : t.fees.length
          ? `Its ${t.kind === 'debt' ? 'interest' : 'transfer fee'} will be deleted too. Balances are recalculated.`
          : links && (links.liabilities.length > 0 || links.distributions.length > 0)
            ? 'It pays a company obligation or distribution, which will show as unpaid again. Balances are recalculated.'
            : plans?.debt
              ? plans.debt.role === 'origin'
                ? 'The debt stays recorded, without this money movement. Balances are recalculated.'
                : `The debt with ${plans.debt.counterparty} will be outstanding again. Balances are recalculated.`
              : plans?.expected
                ? `“${plans.expected.name}” will be unpaid again. Balances are recalculated.`
                : 'Balances are recalculated immediately.') + photoNote,
      'Delete',
      () => remove.mutate(t.id, { onSuccess: () => closeScreen(), onError: (e) => notify('Not possible', e.message) }),
      true,
    );

  const itemsTotal = t.items.reduce((s, i) => s + (i.totalMinor ?? 0) * (i.lineKind === 'discount' ? -1 : 1), 0);

  return (
    <>
      <Stack.Screen
        options={{
          title: t.kind === 'transfer' ? 'Transfer' : t.kind === 'income' ? 'Income' : t.kind === 'adjustment' ? 'Adjustment' : t.kind === 'debt' ? 'Loan' : 'Expense',
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.lg }}>
          <IconBadge
            icon={t.kind === 'transfer' ? 'swap_horiz' : t.kind === 'adjustment' ? 'balance' : t.kind === 'debt' ? 'handshake' : (t.category?.icon ?? 'receipt_long')}
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
              <Line
                label={
                  t.kind === 'income' || (t.kind === 'debt' && signed > 0) ? 'Received into' : t.kind === 'adjustment' ? 'Location' : 'Paid from'
                }>
                {`${t.roles.main?.name ?? '—'}${t.roles.main?.ownership === 'business' ? ' (company)' : ''}`}
              </Line>
              {t.instrument && <Line label="Card">{`${t.instrument.name}${t.instrument.last4 ? ` · ${t.instrument.last4}` : ''}`}</Line>}
              {t.kind === 'debt' &&
                t.fees.map((f) => (
                  <Line key={f.id} label="Interest (an expense)">
                    {formatMoney(f.amountMinor, f.currency)}
                  </Line>
                ))}
              {t.category && <Line label="Category">{t.category.name}</Line>}
              {t.merchantName && <Line label={t.kind === 'income' ? 'From' : 'Merchant'}>{t.merchantName}</Line>}
            </>
          )}
          {t.tags.length > 0 && <Line label="Tags">{t.tags.map((g) => `#${g.name}`).join(' ')}</Line>}
          {t.note && <Line label="Note">{t.note}</Line>}
        </Card>

        {links && (links.liabilities.length > 0 || links.distributions.length > 0) && (
          <View style={{ marginTop: space.md }}>
            <Card padded={false}>
              {links.liabilities.map((l) => (
                <ListItem
                  key={l.id}
                  icon="pending_actions"
                  iconColor={c.business}
                  title={`Pays: ${l.label}`}
                  subtitle={`${formatMoney(l.amountMinor, t.currency)} of this payment`}
                  onPress={() => router.push(`/company/obligation/${l.id}`)}
                  chevron
                />
              ))}
              {links.distributions.map((d) => (
                <ListItem
                  key={d.id}
                  icon="gavel"
                  iconColor={c.business}
                  title="Pays an approved distribution"
                  subtitle={`Approved ${formatDateLabel(d.approvedAt)}. Counted once, as this transfer.`}
                  onPress={() => router.push(`/company/distribution/${d.id}`)}
                  chevron
                />
              ))}
            </Card>
          </View>
        )}

        {plans && (plans.debt || plans.expected) && (
          <View style={{ marginTop: space.md }}>
            <Card padded={false}>
              {plans.debt && (
                <ListItem
                  icon="handshake"
                  iconColor={c.primary}
                  title={
                    plans.debt.role === 'origin'
                      ? plans.debt.direction === 'owe'
                        ? `Borrowed from ${plans.debt.counterparty}`
                        : `Lent to ${plans.debt.counterparty}`
                      : `Repays: ${plans.debt.counterparty}`
                  }
                  subtitle="Open the debt"
                  onPress={() => router.push(`/debts/${planDebtId}`)}
                  chevron
                />
              )}
              {plans.expected && (
                <ListItem
                  icon="event_repeat"
                  iconColor={c.primary}
                  title={`Pays: ${plans.expected.name}`}
                  subtitle={`Due ${formatDateLabel(plans.expected.dueDate)}`}
                  onPress={() => router.push(planRuleId ? `/bills/${planRuleId}` : '/bills')}
                  chevron
                />
              )}
            </Card>
          </View>
        )}
        {t.kind === 'debt' && (
          <View style={{ marginTop: space.md }}>
            <Banner tone="info">
              Loan principal: it changes the balance but is never counted as income or spending. To change it, edit the debt or delete
              this movement and record it again.
            </Banner>
          </View>
        )}

        {isFee && (
          <View style={{ marginTop: space.md }}>
            <Banner tone="info">This belongs to another transaction (a transfer fee or loan interest). Open it to change or delete it.</Banner>
            <Button kind="ghost" label="Open the main transaction" onPress={() => router.replace(`/transactions/${t.parentId}`)} />
          </View>
        )}
        {t.kind === 'adjustment' && (
          <View style={{ marginTop: space.md }}>
            <Banner tone="warning">
              Recorded from a balance check to match the actual balance. Not counted as income or spending.
            </Banner>
          </View>
        )}

        {photos.length > 0 && (
          <>
            <SectionHeader title={photos.length === 1 ? 'Receipt photo' : `Receipt photos · ${photos.length}`} />
            <Row style={{ flexWrap: 'wrap' }} gap={space.md}>
              {photos.map((a) => (
                <PhotoThumb key={a.id} path={a.path} size={96} onPress={() => router.push(`/attachments/${a.id}`)} />
              ))}
            </Row>
          </>
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
                          i.estimated ? 'estimated' : null,
                          i.quantityMilli !== null ? `${formatQuantity(i.quantityMilli)}${i.unit ? ` ${i.unit}` : ''}` : null,
                          i.unitPriceMinor !== null ? `× ${formatMoney(i.unitPriceMinor, t.currency)}${i.unit ? `/${i.unit}` : ''}` : null,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        {i.tagIds.length > 0 ? ` · ${i.tagIds.map((id) => `#${tagNames.get(id) ?? '?'}`).join(' ')}` : ''}
                      </Text>
                    </View>
                    <Text color={i.lineKind === 'discount' ? c.positive : i.estimated ? c.textMuted : undefined}>
                      {i.totalMinor === null
                        ? '—'
                        : `${i.lineKind === 'discount' ? '−' : i.estimated ? '≈ ' : ''}${formatMoney(i.totalMinor, t.currency)}`}
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
