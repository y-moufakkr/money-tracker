import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { dueLabel } from '@/components/occurrence-row';
import { SourcePicker, type Source } from '@/components/entry-pickers';
import { todayISO, formatDateLabel } from '@/domain/dates';
import { formatMoney, minorToInput, parseAmount } from '@/domain/money';
import { useAccountBalances, useLedgerMutation, useOccurrence, useOccurrenceCandidates } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import { closeScreen } from '@/lib/navigation';
import {
  adjustOccurrence,
  linkOccurrence,
  payOccurrence,
  reopenOccurrence,
  skipOccurrence,
  type OccurrenceRef,
  type PayOccurrenceInput,
} from '@/services/recurring';
import { DateField, TextField } from '@/ui/fields';
import { Amount, Banner, Button, Card, Divider, EmptyState, ListItem, Loading, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function OccurrenceScreen() {
  const c = useColors();
  const params = useLocalSearchParams<{ rule?: string; due?: string; expected?: string }>();
  const ref: OccurrenceRef | null = params.expected
    ? { expectedId: params.expected }
    : params.rule && params.due
      ? { ruleId: params.rule, dueDate: params.due }
      : null;
  const q = useOccurrence(ref);
  const candidates = useOccurrenceCandidates(q.data?.status === 'pending' ? ref : null);
  const accounts = useAccountBalances().data;
  const [source, setSource] = useState<Source | null>(null);
  const [amount, setAmount] = useState('');
  const [interest, setInterest] = useState('');
  const [date, setDate] = useState(todayISO());
  const [adjust, setAdjust] = useState('');
  const pay = useLedgerMutation((db, input: PayOccurrenceInput) => payOccurrence(db, input));
  const link = useLedgerMutation((db, v: { ref: OccurrenceRef; transactionId: string }) => linkOccurrence(db, v.ref, v.transactionId));
  const skip = useLedgerMutation((db, r: OccurrenceRef) => skipOccurrence(db, r));
  const reopen = useLedgerMutation((db, r: OccurrenceRef) => reopenOccurrence(db, r));
  const setAmountFor = useLedgerMutation((db, v: { ref: OccurrenceRef; amountMinor: number | null }) => adjustOccurrence(db, v.ref, v.amountMinor));

  if (!ref) return <EmptyState icon="error" title="Payment not found" />;
  if (q.isLoading || !accounts) return <Loading />;
  if (q.error || !q.data) return <EmptyState icon="error" title="Payment not found" message={q.error?.message ?? 'It may have been deleted.'} />;
  const o = q.data;
  const income = o.direction === 'income';
  const usable = accounts.filter((a) => a.ownership === 'personal' && !a.isArchived && (!income || a.kind !== 'credit_card') && (!o.debtId || a.kind !== 'credit_card'));
  const chosen = source ?? (usable.some((a) => a.id === o.accountId) ? { accountId: o.accountId, instrumentId: null } : null);
  const chosenId = chosen?.accountId ?? null;
  const currency = accounts.find((a) => a.id === chosenId)?.currency ?? o.currency;
  const amountMinor = amount.trim() ? parseAmount(amount, currency) : o.amountMinor;
  const interestMinor = interest.trim() ? parseAmount(interest, currency) : null;
  const adjustMinor = adjust.trim() ? parseAmount(adjust, o.currency) : null;
  const fail = (title: string) => (e: Error) => notify(title, e.message);

  const submitPay = () => {
    if (!chosenId || !amountMinor) return notify(income ? 'Choose where it was received and the amount' : 'Choose where it was paid from and the amount');
    if (interest.trim() && !interestMinor) return notify('The interest is not a valid amount');
    pay.mutate(
      { ref: o.ref, accountId: chosenId, date, amountMinor, interestMinor },
      { onSuccess: () => closeScreen(), onError: fail('Could not record it') },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: o.name }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <Card tone={o.overdue ? 'danger' : 'primary'} style={{ gap: space.xs }}>
          <Text variant="label" color={o.overdue ? c.negative : c.primary}>
            {dueLabel(o)}
          </Text>
          <Amount minor={o.amountMinor} currency={o.currency} variant="title" color={income ? c.positive : undefined} />
          <Text variant="caption" tone="muted">
            {income ? 'Expected into' : 'Expected from'} {o.accountName}
            {o.adjusted ? ' · amount adjusted for this date' : ''}
            {o.ruleId ? '' : ' · one-off'}
          </Text>
          {o.ruleId && (
            <Text variant="caption" color={c.primary} onPress={() => router.push(`/bills/${o.ruleId}`)}>
              Open the recurring payment →
            </Text>
          )}
        </Card>
        {o.notes && (
          <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
            {o.notes}
          </Text>
        )}

        {o.status !== 'pending' ? (
          <>
            {o.status === 'paid' && o.transactionId && (
              <View style={{ marginTop: space.md }}>
                <Card padded={false}>
                  <ListItem
                    icon="receipt_long"
                    title={`${income ? 'Received' : 'Paid'} ${formatMoney(o.paidMinor ?? 0, o.currency)}`}
                    subtitle={o.paidDate ? formatDateLabel(o.paidDate) : undefined}
                    onPress={() => router.push(`/transactions/${o.transactionId}`)}
                    chevron
                  />
                </Card>
              </View>
            )}
            <View style={{ marginTop: space.lg }}>
              <Button
                kind="secondary"
                icon="undo"
                label={o.status === 'paid' ? 'Unlink the payment (it stays recorded)' : 'Undo skip'}
                loading={reopen.isPending}
                onPress={() => reopen.mutate(o.ref, { onError: fail('Not possible') })}
              />
            </View>
          </>
        ) : (
          <>
            <SectionHeader title={income ? 'Record it as received' : 'Record the payment'} />
            <Card>
              {usable.length === 0 ? (
                <Text tone="muted">No personal location to use.</Text>
              ) : (
                <>
                  <SourcePicker label={income ? 'Received into' : 'Paid from'} accounts={usable} value={chosen} onChange={setSource} />
                  <TextField
                    label={o.debtId ? 'Principal repaid' : income ? 'Amount received' : 'Amount paid'}
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    placeholder={minorToInput(o.amountMinor, o.currency)}
                    error={amount.trim() && amountMinor === null ? 'Not a valid amount' : null}
                  />
                  {o.debtId && !income && (
                    <TextField
                      label="Interest (optional)"
                      hint="Recorded as a “Loan interest” expense. The principal is not spending."
                      value={interest}
                      onChangeText={setInterest}
                      keyboardType="decimal-pad"
                      placeholder="0"
                    />
                  )}
                  <DateField value={date} onChange={setDate} />
                  <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
                    {o.debtId
                      ? 'Records a loan repayment linked to the debt, and marks this date paid.'
                      : `Records ${income ? 'income' : 'an expense'} with this payment's category, and marks this date paid.`}
                  </Text>
                  <Button
                    icon="check"
                    label={`${income ? 'Received' : 'Paid'} ${formatMoney((amountMinor ?? 0) + (interestMinor ?? 0), currency)}`}
                    onPress={submitPay}
                    loading={pay.isPending}
                  />
                </>
              )}
            </Card>

            <SectionHeader title="…or link one already recorded" />
            {(candidates.data ?? []).length === 0 ? (
              <Banner tone="info">{`No unlinked ${income ? 'income' : 'expenses'} within 45 days of the due date.`}</Banner>
            ) : (
              <Card padded={false}>
                {candidates.data!.slice(0, 12).map((t, i) => (
                  <View key={t.transactionId}>
                    {i > 0 && <Divider inset={space.lg} />}
                    <ListItem
                      title={t.label}
                      subtitle={`${formatDateLabel(t.date)} · ${t.accountName}${t.kind === 'debt' ? ' · loan repayment' : ''}`}
                      right={<Amount minor={t.amountMinor} />}
                      onPress={() =>
                        confirmAction('Link this transaction?', `It will count as ${income ? 'receiving' : 'paying'} “${o.name}” due ${formatDateLabel(o.dueDate)}.`, 'Link', () =>
                          link.mutate({ ref: o.ref, transactionId: t.transactionId }, { onSuccess: () => closeScreen(), onError: fail('Not possible') }),
                        )
                      }
                    />
                  </View>
                ))}
              </Card>
            )}

            {o.ruleId && (
              <>
                <SectionHeader title="Expected amount for this date only" />
                <Card>
                  <TextField
                    label="Expected amount"
                    value={adjust}
                    onChangeText={setAdjust}
                    keyboardType="decimal-pad"
                    placeholder={minorToInput(o.amountMinor, o.currency)}
                    error={adjust.trim() && adjustMinor === null ? 'Not a valid amount' : null}
                  />
                  <Button
                    kind="secondary"
                    label="Update this date"
                    disabled={!adjustMinor}
                    onPress={() => setAmountFor.mutate({ ref: o.ref, amountMinor: adjustMinor }, { onSuccess: () => setAdjust(''), onError: fail('Not possible') })}
                  />
                  {o.adjusted && (
                    <Button kind="ghost" label="Back to the usual amount" onPress={() => setAmountFor.mutate({ ref: o.ref, amountMinor: null }, { onError: fail('Not possible') })} />
                  )}
                </Card>
              </>
            )}

            <View style={{ marginTop: space.xl }}>
              <Button
                kind="ghost"
                icon="event_busy"
                label="Skip this one"
                onPress={() =>
                  confirmAction('Skip this payment?', 'Use this when it is cancelled or was settled outside the app. Nothing is recorded and nothing stays reserved.', 'Skip', () =>
                    skip.mutate(o.ref, { onSuccess: () => closeScreen(), onError: fail('Not possible') }),
                  )
                }
              />
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}
