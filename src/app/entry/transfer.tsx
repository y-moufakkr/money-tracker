import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { SourcePicker, type Source } from '@/components/entry-pickers';
import { todayISO } from '@/domain/dates';
import { BASE_CURRENCY, formatMoney, minorToInput, parseAmount } from '@/domain/money';
import { CROSS_OWNERSHIP_CLASSES, type AccountWithBalance, type TransferClass } from '@/domain/types';
import { useAccountBalances, useLedgerMutation, useTransaction } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { isCrossOwnership, saveTransfer, type TransferInput } from '@/services/ledger';
import { AmountInput, DateField, TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Banner, Button, Card, Chip, EmptyState, Loading, Row, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

type Initial = {
  amount: string;
  received: string;
  fee: string;
  from: Source | null;
  to: Source | null;
  transferClass: TransferClass | null;
  date: string;
  note: string;
};

export default function TransferScreen() {
  const params = useLocalSearchParams<{ id?: string; from?: string; to?: string }>();
  const editing = useTransaction(params.id);
  const accounts = useAccountBalances().data;

  if (!accounts || (params.id && editing.isLoading)) return <Loading />;
  if (params.id && !editing.data) return <EmptyState icon="error" title="Transaction not found" />;
  if (accounts.length < 2) {
    return (
      <EmptyState
        icon="swap_horiz"
        title="You need two locations"
        message="A transfer moves money between two of your locations, e.g. bank → wallet."
        action={{ label: 'Add location', onPress: () => router.replace('/accounts/new') }}
      />
    );
  }

  const t = editing.data;
  const initial: Initial = t
    ? {
        amount: minorToInput(t.amountMinor, t.currency),
        received: t.roles.to && t.roles.to.currency !== t.currency ? minorToInput(t.roles.to.amountMinor, t.roles.to.currency) : '',
        fee: t.fees[0] ? minorToInput(t.fees[0].amountMinor, t.currency) : '',
        from: t.roles.from ? { accountId: t.roles.from.id, instrumentId: null } : null,
        to: t.roles.to ? { accountId: t.roles.to.id, instrumentId: null } : null,
        transferClass: t.transferClass === 'internal' ? null : t.transferClass,
        date: t.date,
        note: t.note ?? '',
      }
    : {
        amount: '',
        received: '',
        fee: '',
        from: params.from ? { accountId: params.from, instrumentId: null } : null,
        to: params.to ? { accountId: params.to, instrumentId: null } : null,
        transferClass: null,
        date: todayISO(),
        note: '',
      };
  return <TransferForm id={params.id ?? null} initial={initial} accounts={accounts} />;
}

function TransferForm({ id, initial, accounts }: { id: string | null; initial: Initial; accounts: AccountWithBalance[] }) {
  const c = useColors();
  const [amount, setAmount] = useState(initial.amount);
  const [received, setReceived] = useState(initial.received);
  const [fee, setFee] = useState(initial.fee);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [transferClass, setTransferClass] = useState(initial.transferClass);
  const [date, setDate] = useState(initial.date);
  const [note, setNote] = useState(initial.note);

  const save = useLedgerMutation((db, input: TransferInput) => saveTransfer(db, input, id));

  const fromAcct = accounts.find((a) => a.id === from?.accountId);
  const toAcct = accounts.find((a) => a.id === to?.accountId);
  const currency = fromAcct?.currency ?? BASE_CURRENCY;
  const multiCurrency = !!fromAcct && !!toAcct && fromAcct.currency !== toAcct.currency;
  const cross = !!fromAcct && !!toAcct && isCrossOwnership(fromAcct, toAcct);
  const amountMinor = amount.trim() ? parseAmount(amount, currency) : null;
  const receivedMinor = multiCurrency && received.trim() ? parseAmount(received, toAcct!.currency) : null;
  const feeMinor = fee.trim() ? parseAmount(fee, currency) : 0;
  const companyToMe = cross && fromAcct?.ownership === 'business' && toAcct?.ownership === 'personal';

  const submit = () => {
    if (amountMinor === null || amountMinor <= 0) return Alert.alert('Enter an amount', 'How much is moving?');
    if (!fromAcct || !toAcct) return Alert.alert('Choose both locations', 'Pick where the money leaves and where it arrives.');
    if (feeMinor === null) return Alert.alert('Check the fee', 'The fee is not a valid amount.');
    save.mutate(
      {
        date,
        fromAccountId: fromAcct.id,
        toAccountId: toAcct.id,
        amountMinor,
        receivedMinor: multiCurrency ? receivedMinor : null,
        feeMinor: feeMinor || null,
        transferClass: cross ? transferClass : 'internal',
        note,
      },
      { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Could not save', e.message) },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: id ? 'Edit transfer' : 'Transfer' }} />
      <FormScreen footer={<Button label="Save transfer" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />}>
        <AmountInput value={amount} onChangeText={setAmount} currency={currency} autoFocus={!id} />

        <SourcePicker label="From" accounts={accounts} value={from} onChange={setFrom} exclude={to?.accountId} />
        <SourcePicker label="To" accounts={accounts} value={to} onChange={setTo} exclude={from?.accountId} />

        {multiCurrency && (
          <TextField
            label={`Amount received in ${toAcct!.currency}`}
            hint="Enter what actually arrived. The rate is implied by the two amounts."
            keyboardType="decimal-pad"
            placeholder="0"
            value={received}
            onChangeText={setReceived}
            trailing={<Text tone="muted">{toAcct!.currency}</Text>}
          />
        )}

        {cross && (
          <Card tone="business" style={{ marginBottom: space.lg, gap: space.sm }}>
            <Text variant="bodyStrong" color={c.business}>
              {companyToMe ? 'Company → you: what is this payment?' : 'Between you and the company: what is this?'}
            </Text>
            <Text variant="caption" tone="muted">
              Required. It decides whether this counts as your income. Nothing is assumed tax-free — check with your accountant.
            </Text>
            <View style={{ gap: space.sm }}>
              {CROSS_OWNERSHIP_CLASSES.map((o) => (
                <View key={o.value}>
                  <Chip label={o.label} color={c.business} selected={transferClass === o.value} onPress={() => setTransferClass(o.value)} />
                  {transferClass === o.value && (
                    <Text variant="caption" tone="muted" style={{ marginTop: 4, marginLeft: space.sm }}>
                      {o.hint}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </Card>
        )}

        <TextField
          label="Fee (optional)"
          hint={`Charged on ${fromAcct?.name ?? 'the source'}. Recorded as a “Bank fees” expense.`}
          keyboardType="decimal-pad"
          placeholder="0"
          value={fee}
          onChangeText={setFee}
          error={feeMinor === null ? 'Not a valid amount' : null}
          trailing={<Text tone="muted">{currency}</Text>}
        />

        <DateField value={date} onChange={setDate} />
        <TextField label={transferClass === 'other' ? 'Note (required)' : 'Note (optional)'} value={note} onChangeText={setNote} multiline />

        {fromAcct && toAcct && amountMinor !== null && amountMinor > 0 && (
          <Banner tone="info" title="Preview">
            <View style={{ gap: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label">{fromAcct.name}</Text>
                <Text variant="label">
                  {formatMoney(fromAcct.balanceMinor, fromAcct.currency)} → {formatMoney(fromAcct.balanceMinor - amountMinor - (feeMinor ?? 0), fromAcct.currency)}
                </Text>
              </Row>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label">{toAcct.name}</Text>
                <Text variant="label">
                  {formatMoney(toAcct.balanceMinor, toAcct.currency)} →{' '}
                  {multiCurrency
                    ? receivedMinor === null
                      ? '?'
                      : formatMoney(toAcct.balanceMinor + receivedMinor, toAcct.currency)
                    : formatMoney(toAcct.balanceMinor + amountMinor, toAcct.currency)}
                </Text>
              </Row>
              {!cross && (
                <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
                  Your total stays the same{feeMinor ? ` except the ${formatMoney(feeMinor, currency)} fee` : ''}. Transfers are never income or spending.
                </Text>
              )}
            </View>
          </Banner>
        )}
      </FormScreen>
    </>
  );
}
