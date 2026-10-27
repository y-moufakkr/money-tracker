import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { SourcePicker, type Source } from '@/components/entry-pickers';
import { formatDateLabel, todayISO } from '@/domain/dates';
import { formatMoney, minorToInput, parseAmount } from '@/domain/money';
import { liabilityKindLabel } from '@/domain/types';
import { useAccountBalances, useLedgerMutation, useLiability, usePaymentCandidates } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import {
  linkLiabilityPayment,
  payLiability,
  unlinkLiabilityPayment,
  type LinkPaymentInput,
  type PayLiabilityInput,
} from '@/services/obligations';
import { DateField, TextField } from '@/ui/fields';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconButton, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function ObligationScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useLiability(id);
  const candidates = usePaymentCandidates(id);
  const accounts = useAccountBalances().data;
  const [source, setSource] = useState<Source | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const pay = useLedgerMutation((db, input: PayLiabilityInput) => payLiability(db, input));
  const link = useLedgerMutation((db, input: LinkPaymentInput) => linkLiabilityPayment(db, input));
  const unlink = useLedgerMutation((db, paymentId: string) => unlinkLiabilityPayment(db, paymentId));

  if (q.isLoading || !accounts) return <Loading />;
  const l = q.data;
  if (!l) return <EmptyState icon="error" title="Obligation not found" message="It may have been deleted." />;

  const companyAccounts = accounts.filter((a) => a.companyId === l.companyId && a.kind !== 'credit_card');
  const amountMinor = amount.trim() ? parseAmount(amount) : l.outstandingMinor;
  const liabilityId = l.id;
  const outstanding = l.outstandingMinor;

  const submitPay = () => {
    if (!source || !amountMinor) {
      notify('Choose the company account and the amount paid');
      return;
    }
    pay.mutate(
      { liabilityId, accountId: source.accountId, date, amountMinor },
      {
        onSuccess: () => {
          setAmount('');
          setSource(null);
        },
        onError: (e) => notify('Could not record the payment', e.message),
      },
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: liabilityKindLabel(l.kind),
          headerRight: () => (
            <IconButton icon="edit" label="Edit obligation" onPress={() => router.push(`/company/obligation-edit?companyId=${l.companyId}&id=${l.id}`)} />
          ),
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <Card tone="business" style={{ gap: space.xs }}>
          <Text variant="label" color={c.business}>
            {l.label}
          </Text>
          <Amount minor={l.outstandingMinor} currency={l.currency} variant="title" color={l.overdue ? c.negative : c.business} />
          <Text variant="caption" tone="muted">
            {l.status === 'paid' ? 'Fully paid' : 'Outstanding'} · amount {formatMoney(l.amountMinor, l.currency)} − paid {formatMoney(l.paidMinor, l.currency)}
            {l.dueDate ? ` · due ${formatDateLabel(l.dueDate)}` : ''}
            {l.overdue ? ` · ${l.daysOverdue} days overdue` : ''}
          </Text>
          {l.distributionId && (
            <Text variant="caption" color={c.primary} onPress={() => router.push(`/company/distribution/${l.distributionId}`)}>
              Created by an approved distribution →
            </Text>
          )}
        </Card>
        {l.notes && (
          <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
            {l.notes}
          </Text>
        )}

        <SectionHeader title="Linked payments" />
        <Card padded={false}>
          {l.payments.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text tone="muted">No payment linked yet.</Text>
            </View>
          ) : (
            l.payments.map((p, i) => (
              <View key={p.id}>
                {i > 0 && <Divider inset={space.lg} />}
                <Row style={{ paddingRight: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <ListItem
                      title={formatMoney(p.amountMinor, l.currency)}
                      subtitle={`${formatDateLabel(p.date)} · ${p.kind}${p.note ? ` · ${p.note}` : ''}`}
                      onPress={() => router.push(`/transactions/${p.transactionId}`)}
                    />
                  </View>
                  <IconButton
                    icon="link_off"
                    label="Unlink payment"
                    color={c.textMuted}
                    onPress={() =>
                      confirmAction('Unlink this payment?', 'The payment stays recorded; the obligation becomes outstanding again.', 'Unlink', () =>
                        unlink.mutate(p.id, { onError: (e) => notify('Not possible', e.message) }),
                      )
                    }
                  />
                </Row>
              </View>
            ))
          )}
        </Card>

        {outstanding > 0 && (
          <>
            <SectionHeader title="Record the payment" />
            <Card>
              {companyAccounts.length === 0 ? (
                <Text tone="muted">The company has no account to pay from.</Text>
              ) : (
                <>
                  <SourcePicker label="Paid from" accounts={companyAccounts} value={source} onChange={setSource} />
                  <TextField
                    label="Amount paid"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    placeholder={minorToInput(outstanding)}
                    error={amount.trim() && amountMinor === null ? 'Not a valid amount' : null}
                  />
                  <DateField value={date} onChange={setDate} />
                  <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
                    Records one company expense{l.kind === 'is' || l.kind === 'tva' || l.kind === 'withholding' || l.kind === 'dividend' ? ' (not counted as a cost in the P&L)' : ''} and links it here.
                    The company’s cash and this obligation go down together.
                  </Text>
                  <Button kind="business" icon="payments" label={`Pay ${formatMoney(amountMinor ?? 0, l.currency)}`} onPress={submitPay} loading={pay.isPending} />
                </>
              )}
            </Card>

            <SectionHeader title="…or link a payment already recorded" />
            {(candidates.data ?? []).length === 0 ? (
              <Banner tone="info">No unlinked company payments found.</Banner>
            ) : (
              <Card padded={false}>
                {candidates.data!.slice(0, 15).map((p, i) => (
                  <View key={p.transactionId}>
                    {i > 0 && <Divider inset={space.lg} />}
                    <ListItem
                      title={p.label}
                      subtitle={`${formatDateLabel(p.date)} · ${p.kind}${p.freeMinor < p.amountMinor ? ` · ${formatMoney(p.freeMinor)} not linked yet` : ''}`}
                      right={<Amount minor={p.amountMinor} />}
                      onPress={() => {
                        const part = Math.min(p.freeMinor, outstanding);
                        confirmAction(
                          'Link this payment?',
                          `${formatMoney(part, l.currency)} of it will count as paid on “${l.label}”.`,
                          'Link',
                          () => link.mutate({ liabilityId, transactionId: p.transactionId, amountMinor: part }, { onError: (e) => notify('Not possible', e.message) }),
                        );
                      }}
                    />
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}
