import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { SourcePicker, type Source } from '@/components/entry-pickers';
import { addMonths, todayISO } from '@/domain/dates';
import { BASE_CURRENCY, minorToInput, parseAmount } from '@/domain/money';
import type { AccountWithBalance } from '@/domain/types';
import { useAccountBalances, useDebt, useLedgerMutation } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import { closeScreen } from '@/lib/navigation';
import { deleteDebt, saveDebt, type Debt, type DebtDirection, type DebtInput } from '@/services/debts';
import { AmountInput, DateButton, Field, TextField, Toggle } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Banner, Button, EmptyState, Loading, Segmented, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

const FAR = '2100-12-31';

export default function DebtEditScreen() {
  const { id, direction } = useLocalSearchParams<{ id?: string; direction?: DebtDirection }>();
  const debt = useDebt(id);
  const accounts = useAccountBalances();
  if ((id && debt.isLoading) || accounts.isLoading) return <Loading />;
  if (id && !debt.data) return <EmptyState icon="error" title="Debt not found" />;
  const usable = (accounts.data ?? []).filter((a) => a.ownership === 'personal' && a.kind !== 'credit_card');
  return <DebtForm existing={debt.data ?? null} accounts={usable} initialDirection={direction ?? 'owe'} />;
}

function DebtForm({ existing, accounts, initialDirection }: { existing: Debt | null; accounts: AccountWithBalance[]; initialDirection: DebtDirection }) {
  const [dir, setDir] = useState<DebtDirection>(existing?.direction ?? initialDirection);
  const [who, setWho] = useState(existing?.counterparty ?? '');
  const [amount, setAmount] = useState(existing ? minorToInput(existing.principalMinor, existing.currency) : '');
  const [moved, setMoved] = useState(existing ? !!existing.originAccount : true);
  const [source, setSource] = useState<Source | null>(existing?.originAccount ? { accountId: existing.originAccount.id, instrumentId: null } : null);
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayISO());
  const [hasDue, setHasDue] = useState(existing ? !!existing.dueDate : false);
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? addMonths(todayISO(), 3));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const save = useLedgerMutation((db, v: { id: string | null; input: DebtInput }) => saveDebt(db, v.input, v.id));
  const remove = useLedgerMutation((db, debtId: string) => deleteDebt(db, debtId));

  const account = accounts.find((a) => a.id === source?.accountId);
  const currency = moved ? (account?.currency ?? BASE_CURRENCY) : (existing?.currency ?? BASE_CURRENCY);
  const amountMinor = amount.trim() ? parseAmount(amount, currency) : null;
  const owe = dir === 'owe';
  const sourceId = source?.accountId ?? null;
  const existingId = existing?.id ?? null;

  const submit = () => {
    if (!amountMinor) return notify('Enter the amount');
    if (!who.trim()) return notify(owe ? 'Who do you owe?' : 'Who owes you?');
    if (moved && !sourceId) return notify(owe ? 'Choose where the money arrived' : 'Choose where the money came from');
    save.mutate(
      {
        id: existingId,
        input: {
          direction: dir,
          counterparty: who,
          principalMinor: amountMinor,
          startDate,
          dueDate: hasDue ? dueDate : null,
          notes,
          originAccountId: moved ? sourceId : null,
          currency,
        },
      },
      { onSuccess: () => closeScreen(), onError: (e) => notify('Could not save', e.message) },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Edit debt' : owe ? 'Money I owe' : 'Money owed to me' }} />
      <FormScreen
        footer={
          <>
            {existingId && (
              <Button
                kind="danger"
                label="Delete"
                onPress={() =>
                  confirmAction('Delete this debt?', 'The money movements and repayments stay recorded in your transactions; only the debt record goes.', 'Delete', () =>
                    remove.mutate(existingId, { onSuccess: () => closeScreen(), onError: (e) => notify('Not possible', e.message) }),
                  true)
                }
              />
            )}
            <Button label="Save" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />
          </>
        }>
        {!existing && (
          <Field>
            <Segmented
              options={[
                { value: 'owe', label: 'I owe' },
                { value: 'owed', label: 'Owed to me' },
              ]}
              value={dir}
              onChange={setDir}
            />
          </Field>
        )}
        <AmountInput value={amount} onChangeText={setAmount} currency={currency} autoFocus={!existing} accessibilityLabel={owe ? 'Amount owed' : 'Amount owed to you'} />
        <TextField label={owe ? 'Owed to' : 'Owed by'} value={who} onChangeText={setWho} placeholder={owe ? 'e.g. Brother, Bank (car loan)' : 'e.g. Ahmed'} />
        <Toggle
          label={owe ? 'I received this money' : 'I gave this money'}
          description={
            owe
              ? 'On: borrowed money arrived in a location (its balance goes up, not as income). Off: someone paid something for you, or the debt is older than your records.'
              : 'On: lent money left a location (its balance goes down, not as spending). Off: you sold something on credit, or it is older than your records.'
          }
          value={moved}
          onChange={setMoved}
        />
        {moved && (
          <SourcePicker label={owe ? 'Received into' : 'Paid from'} accounts={accounts} value={source} onChange={setSource} />
        )}
        <Field label={owe ? 'Borrowed on' : 'Lent on'}>
          <DateButton value={startDate} onChange={setStartDate} maximumDate={moved ? todayISO() : FAR} />
        </Field>
        <Toggle label="Has a due date" value={hasDue} onChange={setHasDue} />
        {hasDue && (
          <View style={{ marginVertical: space.sm }}>
            <DateButton label="Due" value={dueDate} minimumDate={startDate} maximumDate={FAR} onChange={setDueDate} />
          </View>
        )}
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional (interest rate, agreement…)" />
        {existing && existing.payments.length > 0 && (
          <Banner tone="info">{`Repayments recorded: ${existing.payments.length}. The amount cannot go below what is already repaid.`}</Banner>
        )}
        {!moved && !owe && (
          <Text variant="caption" tone="muted">
            When it is repaid, record the repayment from the debt screen: it then raises your balance without counting as income.
          </Text>
        )}
      </FormScreen>
    </>
  );
}
