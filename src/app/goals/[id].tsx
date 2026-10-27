import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { Meter } from '@/components/charts';
import { SourcePicker, type Source } from '@/components/entry-pickers';
import { formatDateLabel } from '@/domain/dates';
import { formatMoney, minorToInput, parseAmount } from '@/domain/money';
import { useAccountBalances, useAccountReservations, useGoal, useLedgerMutation } from '@/hooks/data';
import { OverAllocationError, setAllocation, type AllocationInput } from '@/services/goals';
import { TextField } from '@/ui/fields';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconBadge, IconButton, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function GoalScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const goal = useGoal(id);
  const accounts = useAccountBalances().data;
  const reservations = useAccountReservations().data;
  const [source, setSource] = useState<Source | null>(null);
  const [amount, setAmount] = useState('');
  const save = useLedgerMutation((db, input: AllocationInput) => setAllocation(db, input));

  if (goal.isLoading || !accounts || !reservations) return <Loading />;
  const g = goal.data;
  if (!g) return <EmptyState icon="error" title="Goal not found" message="It may have been deleted." />;

  const eligible = accounts.filter((a) => a.ownership === 'personal' && a.kind !== 'credit_card');
  const account = eligible.find((a) => a.id === source?.accountId);
  const existing = g.allocations.find((a) => a.accountId === account?.id);
  const r = account ? reservations.get(account.id) : undefined;
  const elsewhere = (r?.allocatedMinor ?? 0) - (existing?.amountMinor ?? 0);
  const free = account ? account.balanceMinor - elsewhere : 0;
  const amountMinor = amount.trim() ? parseAmount(amount, account?.currency) : null;

  const run = (input: AllocationInput, done?: () => void) =>
    save.mutate(input, {
      onSuccess: () => done?.(),
      onError: (e) => {
        // Compare by name too: subclassed errors can lose their prototype after transpilation.
        if (e instanceof OverAllocationError || e.name === 'OverAllocationError') {
          Alert.alert('Reserve more than is available?', `${e.message}\n\nThe goal will only count what the account actually holds.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reserve anyway', style: 'destructive', onPress: () => run({ ...input, allowOverAllocation: true }, done) },
          ]);
        } else Alert.alert('Could not save', e.message);
      },
    });

  const submit = () => {
    if (!account || amountMinor === null) {
      Alert.alert('Choose an account and an amount', 'Which account holds the money, and how much of it is for this goal?');
      return;
    }
    run({ goalId: g.id, accountId: account.id, amountMinor }, () => {
      setAmount('');
      setSource(null);
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: g.name,
          headerRight: () => <IconButton icon="edit" label="Edit goal" onPress={() => router.push(`/goals/edit?id=${g.id}`)} />,
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <Card tone="primary" style={{ gap: space.sm }}>
          <Row gap={space.md}>
            <IconBadge icon={g.icon ?? 'flag'} color={c.primary} size={44} />
            <View style={{ flex: 1 }}>
              <Text variant="label" color={c.primary}>
                Reserved
              </Text>
              <Amount minor={g.savedMinor} variant="title" />
            </View>
            <Text variant="title">{Math.floor(g.progress * 100)}%</Text>
          </Row>
          <Meter ratio={g.progress} height={10} />
          <Text variant="caption" tone="muted">
            Target {formatMoney(g.targetMinor)} · {g.remainingMinor > 0 ? `${formatMoney(g.remainingMinor)} to go` : 'reached'}
            {g.targetDate ? ` · by ${formatDateLabel(g.targetDate)}` : ''}
          </Text>
        </Card>

        {g.remainingMinor > 0 && (g.plan.neededPerMonthMinor !== null || g.plan.monthsAtPlan !== null) && (
          <Card style={{ marginTop: space.sm, gap: 4 }}>
            {g.plan.neededPerMonthMinor !== null && (
              <Text variant="label">
                Needs {formatMoney(g.plan.neededPerMonthMinor)}/month: {formatMoney(g.remainingMinor)} ÷ {g.plan.monthsLeft} month
                {g.plan.monthsLeft! > 1 ? 's' : ''} left.
              </Text>
            )}
            {g.plan.monthsAtPlan !== null && (
              <Text variant="label" color={g.plan.onTrack === false ? c.warning : undefined}>
                At your plan of {formatMoney(g.monthlyPlanMinor!)}/month: {g.plan.monthsAtPlan} month{g.plan.monthsAtPlan > 1 ? 's' : ''}
                {g.plan.projectedDate ? ` (around ${formatDateLabel(g.plan.projectedDate)})` : ''}
                {g.plan.onTrack === false ? ' — later than the target date.' : '.'}
              </Text>
            )}
          </Card>
        )}

        {g.unbackedMinor > 0 && (
          <View style={{ marginTop: space.sm }}>
            <Banner tone="warning" title="Not fully covered">
              {`${formatMoney(g.unbackedMinor)} of what is reserved for this goal is not in the account right now, so it is not counted. Lower the reservation or add money to the account.`}
            </Banner>
          </View>
        )}
        {g.unconverted.length > 0 && (
          <View style={{ marginTop: space.sm }}>
            <Banner tone="warning">{`Reservations in ${g.unconverted.join(', ')} are not counted — add an exchange rate in Settings.`}</Banner>
          </View>
        )}

        <SectionHeader title="Where the money is" />
        <Card padded={false}>
          {g.allocations.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text tone="muted">Nothing reserved yet. Choose an account below.</Text>
            </View>
          ) : (
            g.allocations.map((a, i) => (
              <View key={a.id}>
                {i > 0 && <Divider inset={68} />}
                <ListItem
                  icon="account_balance_wallet"
                  iconColor={c.primary}
                  title={a.accountName}
                  subtitle={
                    a.backedMinor < a.amountMinor
                      ? `${formatMoney(a.amountMinor, a.currency)} reserved · only ${formatMoney(a.backedMinor, a.currency)} covered`
                      : 'Reserved in this account'
                  }
                  right={<Amount minor={a.amountMinor} currency={a.currency} />}
                  onPress={() => {
                    setSource({ accountId: a.accountId, instrumentId: null });
                    setAmount(minorToInput(a.amountMinor, a.currency));
                  }}
                />
              </View>
            ))
          )}
        </Card>

        <SectionHeader title={existing ? 'Change reservation' : 'Reserve money'} />
        <Card>
          {eligible.length === 0 ? (
            <Text tone="muted">Add a personal account first.</Text>
          ) : (
            <>
              <SourcePicker label="From account" accounts={eligible} value={source} onChange={setSource} />
              {account && (
                <Text variant="caption" tone="muted" style={{ marginTop: -space.sm, marginBottom: space.md }}>
                  Balance {formatMoney(account.balanceMinor, account.currency)} · reserved for other goals {formatMoney(elsewhere, account.currency)} ·{' '}
                  <Text variant="caption" color={free < 0 ? c.negative : c.primary}>
                    {formatMoney(Math.max(0, free), account.currency)} available
                  </Text>
                </Text>
              )}
              <TextField
                label="Amount for this goal"
                hint="This is the total reserved in this account, not an addition. 0 removes it."
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                error={amount.trim() && amountMinor === null ? 'Not a valid amount' : null}
              />
              {account && amountMinor !== null && amountMinor > (existing?.amountMinor ?? 0) && amountMinor > free && (
                <Text variant="caption" color={c.warning} style={{ marginTop: -space.sm, marginBottom: space.md }}>
                  That is more than the {formatMoney(Math.max(0, free), account.currency)} available — you will be asked to confirm.
                </Text>
              )}
              <Row>
                <Button label={existing ? 'Update' : 'Reserve'} icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />
                {existing && (
                  <Button
                    kind="danger"
                    label="Release"
                    onPress={() =>
                      run({ goalId: g.id, accountId: existing.accountId, amountMinor: 0 }, () => {
                        setAmount('');
                        setSource(null);
                      })
                    }
                  />
                )}
              </Row>
            </>
          )}
        </Card>
        {g.notes && (
          <Text variant="caption" tone="muted" style={{ marginTop: space.lg }}>
            {g.notes}
          </Text>
        )}
      </ScrollView>
    </>
  );
}
