import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { SourcePicker, type Source } from '@/components/entry-pickers';
import { formatDateLabel, todayISO } from '@/domain/dates';
import { formatMoney, minorToInput, parseAmount } from '@/domain/money';
import { useAccountBalances, useDebt, useLedgerMutation, useRepaymentCandidates } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import { linkRepayment, recordRepayment, setDebtClosed, unlinkRepayment, type LinkRepaymentInput, type RepaymentInput } from '@/services/debts';
import { DateField, TextField } from '@/ui/fields';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconButton, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function DebtScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useDebt(id);
  const candidates = useRepaymentCandidates(q.data && q.data.outstandingMinor > 0 ? id : undefined);
  const accounts = useAccountBalances().data;
  const [source, setSource] = useState<Source | null>(null);
  const [amount, setAmount] = useState('');
  const [interest, setInterest] = useState('');
  const [date, setDate] = useState(todayISO());
  const repay = useLedgerMutation((db, input: RepaymentInput) => recordRepayment(db, input));
  const link = useLedgerMutation((db, input: LinkRepaymentInput) => linkRepayment(db, input));
  const unlink = useLedgerMutation((db, paymentId: string) => unlinkRepayment(db, paymentId));
  const close = useLedgerMutation((db, v: { id: string; closed: boolean }) => setDebtClosed(db, v.id, v.closed));

  if (q.isLoading || !accounts) return <Loading />;
  const d = q.data;
  if (!d) return <EmptyState icon="error" title="Debt not found" message="It may have been deleted." />;
  const owe = d.direction === 'owe';
  const usable = accounts.filter((a) => a.ownership === 'personal' && a.kind !== 'credit_card' && a.currency === d.currency);
  const amountMinor = amount.trim() ? parseAmount(amount, d.currency) : d.outstandingMinor;
  const interestMinor = interest.trim() ? parseAmount(interest, d.currency) : null;
  const debtId = d.id;
  const sourceId = source?.accountId ?? null;
  const fail = (title: string) => (e: Error) => notify(title, e.message);

  const submit = () => {
    if (!sourceId || !amountMinor) return notify(owe ? 'Choose where you paid from and the amount' : 'Choose where you received it and the amount');
    if (interest.trim() && !interestMinor) return notify('The interest is not a valid amount');
    repay.mutate(
      { debtId, accountId: sourceId, date, amountMinor, interestMinor },
      {
        onSuccess: () => {
          setAmount('');
          setInterest('');
          setSource(null);
        },
        onError: fail('Could not record the repayment'),
      },
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: d.counterparty,
          headerRight: () => <IconButton icon="edit" label="Edit debt" onPress={() => router.push(`/debts/edit?id=${d.id}`)} />,
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <Card tone={d.overdue ? 'danger' : 'primary'} style={{ gap: space.xs }}>
          <Text variant="label" color={d.overdue ? c.negative : c.primary}>
            {owe ? `I owe ${d.counterparty}` : `${d.counterparty} owes me`}
          </Text>
          <Amount minor={d.outstandingMinor} currency={d.currency} variant="title" />
          <Text variant="caption" tone="muted">
            {d.status === 'closed' ? 'Closed' : d.status === 'paid' ? 'Fully repaid' : 'Outstanding'} · {formatMoney(d.principalMinor, d.currency)} −{' '}
            {formatMoney(d.paidMinor, d.currency)} repaid
            {d.dueDate ? ` · due ${formatDateLabel(d.dueDate)}` : ''}
            {d.overdue ? ` · ${d.daysOverdue} days overdue` : ''}
          </Text>
          <Text variant="caption" tone="muted">
            {d.originAccount
              ? `${owe ? 'Received into' : 'Paid from'} ${d.originAccount.name} · ${formatDateLabel(d.startDate)} · not ${owe ? 'income' : 'spending'}`
              : `Since ${formatDateLabel(d.startDate)} · no money movement recorded at the start`}
          </Text>
          {d.originTransactionId && (
            <Text variant="caption" color={c.primary} onPress={() => router.push(`/transactions/${d.originTransactionId}`)}>
              Open the starting movement →
            </Text>
          )}
        </Card>
        <View style={{ marginTop: space.md }}>
          <Banner tone="info">
            {owe
              ? 'Counted in your liabilities next to credit cards. Repaying lowers your money and the debt together; only interest is spending.'
              : 'Not counted as your money until it is repaid. A repayment raises your balance without counting as income.'}
          </Banner>
        </View>
        {d.notes && (
          <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
            {d.notes}
          </Text>
        )}
        {d.closedAt && (
          <View style={{ marginTop: space.md }}>
            <Banner tone="warning" title={`Closed ${formatDateLabel(d.closedAt.slice(0, 10))}`}>
              {`${d.closeNote ? `${d.closeNote}. ` : ''}What was left is no longer counted.`}
            </Banner>
          </View>
        )}

        <SectionHeader title="Repayments" />
        <Card padded={false}>
          {d.payments.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text tone="muted">No repayment yet.</Text>
            </View>
          ) : (
            d.payments.map((p, i) => (
              <View key={p.id}>
                {i > 0 && <Divider inset={space.lg} />}
                <Row style={{ paddingRight: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <ListItem
                      title={formatMoney(p.amountMinor, d.currency)}
                      subtitle={`${formatDateLabel(p.date)} · ${p.kind === 'debt' ? 'repayment' : p.kind}${p.accountName ? ` · ${p.accountName}` : ''}`}
                      onPress={() => router.push(`/transactions/${p.transactionId}`)}
                    />
                  </View>
                  <IconButton
                    icon="link_off"
                    label="Unlink repayment"
                    color={c.textMuted}
                    onPress={() =>
                      confirmAction('Unlink this repayment?', 'The transaction stays recorded; the debt becomes outstanding again by this amount.', 'Unlink', () =>
                        unlink.mutate(p.id, { onError: fail('Not possible') }),
                      )
                    }
                  />
                </Row>
              </View>
            ))
          )}
        </Card>

        {d.outstandingMinor > 0 && (
          <>
            <SectionHeader title={owe ? 'Record a repayment' : 'Record money received back'} />
            <Card>
              {usable.length === 0 ? (
                <Text tone="muted">{`No personal ${d.currency} location to use.`}</Text>
              ) : (
                <>
                  <SourcePicker label={owe ? 'Paid from' : 'Received into'} accounts={usable} value={source} onChange={setSource} />
                  <TextField
                    label="Amount repaid"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    placeholder={minorToInput(d.outstandingMinor, d.currency)}
                    error={amount.trim() && amountMinor === null ? 'Not a valid amount' : null}
                  />
                  {owe && (
                    <TextField
                      label="Interest (optional)"
                      hint="Recorded as a “Loan interest” expense on top of the repayment."
                      value={interest}
                      onChangeText={setInterest}
                      keyboardType="decimal-pad"
                      placeholder="0"
                    />
                  )}
                  <DateField value={date} onChange={setDate} minimumDate={d.startDate} />
                  <Button
                    icon="check"
                    label={`${owe ? 'Repay' : 'Received'} ${formatMoney((amountMinor ?? 0) + (interestMinor ?? 0), d.currency)}`}
                    onPress={submit}
                    loading={repay.isPending}
                  />
                </>
              )}
            </Card>

            <SectionHeader title="…or link a transaction already recorded" />
            {(candidates.data ?? []).length === 0 ? (
              <Banner tone="info">{owe ? 'No unlinked personal expenses or repayments since the start date.' : 'No unlinked personal income since the start date.'}</Banner>
            ) : (
              <Card padded={false}>
                {candidates.data!.slice(0, 12).map((t, i) => (
                  <View key={t.transactionId}>
                    {i > 0 && <Divider inset={space.lg} />}
                    <ListItem
                      title={t.label}
                      subtitle={`${formatDateLabel(t.date)} · ${t.kind === 'debt' ? 'loan movement' : t.kind} · ${t.accountName}`}
                      right={<Amount minor={t.amountMinor} currency={d.currency} />}
                      onPress={() => {
                        const part = t.kind === 'debt' ? t.amountMinor : Math.min(t.amountMinor, d.outstandingMinor);
                        confirmAction(
                          'Link as a repayment?',
                          `${formatMoney(part, d.currency)} of it will count as repaid${t.kind === 'debt' ? '' : `; it stays ${t.kind === 'expense' ? 'an expense' : 'income'}`}.`,
                          'Link',
                          () => link.mutate({ debtId, transactionId: t.transactionId, amountMinor: part }, { onError: fail('Not possible') }),
                        );
                      }}
                    />
                  </View>
                ))}
              </Card>
            )}
          </>
        )}

        <View style={{ marginTop: space.xl, gap: space.sm }}>
          {d.closedAt ? (
            <Button kind="secondary" icon="undo" label="Reopen" onPress={() => close.mutate({ id: d.id, closed: false }, { onError: fail('Not possible') })} />
          ) : (
            d.outstandingMinor > 0 && (
              <Button
                kind="ghost"
                icon="block"
                label={owe ? 'Close (forgiven / settled otherwise)' : 'Close (written off / forgiven)'}
                onPress={() =>
                  confirmAction(
                    'Close this debt?',
                    `${formatMoney(d.outstandingMinor, d.currency)} will no longer be counted as ${owe ? 'a liability' : 'owed to you'}. You can reopen it.`,
                    'Close',
                    () => close.mutate({ id: d.id, closed: true }, { onError: fail('Not possible') }),
                  )
                }
              />
            )
          )}
          {owe && d.outstandingMinor > 0 && (
            <Button kind="ghost" icon="event_repeat" label="Plan monthly installments" onPress={() => router.push('/bills/edit')} />
          )}
        </View>
      </ScrollView>
    </>
  );
}
