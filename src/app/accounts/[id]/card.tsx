import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { useAccount, useLedgerMutation } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { createInstrument } from '@/services/accounts';
import { TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Banner, Button, Loading, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function AddCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: account } = useAccount(id);
  const [name, setName] = useState('');
  const [last4, setLast4] = useState('');
  const save = useLedgerMutation((db, _: void) => createInstrument(db, { name: name || 'Debit card', kind: 'debit', accountId: id, last4 }));

  if (!account) return <Loading />;

  return (
    <FormScreen
      footer={
        <Button
          label="Add debit card"
          loading={save.isPending}
          style={{ flex: 1 }}
          onPress={() => save.mutate(undefined, { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Could not add card', e.message) })}
        />
      }>
      <Text variant="heading" style={{ marginBottom: space.sm }}>
        Debit card for {account.name}
      </Text>
      <Banner tone="info" title="No extra money">
        {`Payments with this card come out of “${account.name}”. The card has no balance of its own, so your total stays the same. For a prepaid card with its own loaded balance, add it as a “Prepaid card” location instead.`}
      </Banner>
      <TextField label="Card name" placeholder="e.g. Visa debit" value={name} onChangeText={setName} autoFocus />
      <TextField
        label="Last 4 digits (optional)"
        placeholder="1234"
        keyboardType="number-pad"
        maxLength={4}
        value={last4}
        onChangeText={(t) => setLast4(t.replace(/\D/g, ''))}
      />
    </FormScreen>
  );
}
