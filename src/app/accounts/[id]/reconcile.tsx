import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { formatMoney, parseSignedAmount } from '@/domain/money';
import { useAccount, useDb, useLedgerMutation } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { accountBalance } from '@/services/balances';
import { reconcileAccount, type ReconcileInput } from '@/services/reconciliation';
import { DateField, TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Amount, Banner, Button, Card, Divider, Loading, Row, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function ReconcileScreen() {
  const c = useColors();
  const db = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: account } = useAccount(id);
  const [date, setDate] = useState(todayISO());
  const [actual, setActual] = useState('');
  const [note, setNote] = useState('');

  const calculated = useQuery({
    queryKey: ['ledger', 'balance-at', id, date],
    queryFn: () => accountBalance(db, id, date),
    enabled: !!id,
  });

  const save = useLedgerMutation((d, input: ReconcileInput) => reconcileAccount(d, input));

  if (!account || calculated.data === undefined) return <Loading />;

  const isCredit = account.kind === 'credit_card';
  // Credit cards: the user types the amount owed (positive); the ledger stores it as negative.
  const typed = actual.trim() === '' ? null : parseSignedAmount(actual, account.currency);
  const statement = typed === null ? null : isCredit ? -typed : typed;
  const diff = statement === null ? null : statement - calculated.data;

  const submit = (action: ReconcileInput['action']) => {
    if (statement === null) return;
    save.mutate(
      { accountId: id, date, statementBalanceMinor: statement, action, note },
      {
        onSuccess: (r) => {
          closeScreen();
          if (r.status === 'matched') Alert.alert('Balance confirmed', 'Your records match the actual balance.');
        },
        onError: (e) => Alert.alert('Could not save', e.message),
      },
    );
  };

  return (
    <FormScreen
      footer={
        diff === null ? (
          <Button label="Enter the actual balance" disabled onPress={() => {}} style={{ flex: 1 }} />
        ) : diff === 0 ? (
          <Button label="Confirm — balances match" icon="check" onPress={() => submit('adjust')} loading={save.isPending} style={{ flex: 1 }} />
        ) : (
          <View style={{ flex: 1, gap: space.sm }}>
            <Button label="Record adjustment" icon="balance" onPress={() => submit('adjust')} loading={save.isPending} />
            <Button label="Keep open & investigate" kind="secondary" icon="search" onPress={() => submit('investigate')} disabled={save.isPending} />
          </View>
        )
      }>
      <Text variant="heading">{account.name}</Text>
      <Text tone="muted" style={{ marginBottom: space.lg }}>
        Compare what the app calculated with the real {isCredit ? 'amount owed' : 'balance'} from your banking app, statement or by
        counting cash.
      </Text>

      <DateField label="Balance on" value={date} onChange={setDate} minimumDate={account.openingDate} />

      <TextField
        label={isCredit ? 'Actual amount owed' : 'Actual balance'}
        placeholder="0"
        keyboardType="numbers-and-punctuation"
        value={actual}
        onChangeText={setActual}
        autoFocus
        error={actual.trim() !== '' && typed === null ? 'Not a valid amount' : null}
        trailing={<Text tone="muted">{account.currency}</Text>}
      />

      <Card style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text tone="muted">App balance</Text>
          <Amount minor={isCredit ? -calculated.data : calculated.data} currency={account.currency} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text tone="muted">Actual balance</Text>
          {typed === null ? <Text tone="faint">—</Text> : <Amount minor={typed} currency={account.currency} />}
        </Row>
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">Difference</Text>
          {diff === null ? (
            <Text tone="faint">—</Text>
          ) : (
            <Amount minor={diff} currency={account.currency} sign="always" color={diff === 0 ? c.positive : c.negative} />
          )}
        </Row>
      </Card>

      {diff !== null && diff !== 0 && (
        <View style={{ marginTop: space.lg, gap: space.md }}>
          <Banner tone="warning" title={`${formatMoney(Math.abs(diff), account.currency)} ${diff < 0 ? 'missing' : 'extra'}`}>
            {diff < 0
              ? 'There is less money than recorded. Often a forgotten expense, bank fee or cash withdrawal. You can record it now and re-check, or keep this open.'
              : 'There is more money than recorded. Often unrecorded income, a refund or a transfer. Record it, or keep this open.'}
          </Banner>
          <Text variant="caption" tone="muted">
            “Record adjustment” adds a visible “balance adjustment” entry. It is never counted as income or spending, and you can delete it later — which re-opens this check.
          </Text>
          <TextField label="Note (optional)" placeholder="e.g. Couldn't find a 100 DH withdrawal" value={note} onChangeText={setNote} />
        </View>
      )}
    </FormScreen>
  );
}
