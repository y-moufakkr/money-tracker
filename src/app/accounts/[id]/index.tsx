import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, View } from 'react-native';

import { TransactionRow } from '@/components/transaction-row';
import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { accountKindLabel } from '@/domain/types';
import { useAccount, useAccountLedger, useGoals, useInstruments, useLedgerMutation, useReconciliations, useTransactions } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { deleteAccount, setAccountArchived, setInstrumentArchived } from '@/services/accounts';
import { recheckReconciliation } from '@/services/reconciliation';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconButton, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const STATUS = {
  matched: { label: 'Matched', tone: 'positive' },
  adjusted: { label: 'Adjusted', tone: 'warning' },
  open: { label: 'Investigating', tone: 'negative' },
} as const;

export default function AccountScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: account, isLoading } = useAccount(id);
  const ledger = useAccountLedger(account);
  const txs = useTransactions({ accountId: id, limit: 200 });
  const cards = (useInstruments().data ?? []).filter((i) => i.accountId === id);
  const recs = useReconciliations(id).data ?? [];
  const reservedFor = (useGoals().data ?? []).flatMap((g) =>
    g.allocations.filter((a) => a.accountId === id).map((a) => ({ ...a, goal: g.name })),
  );

  const archive = useLedgerMutation((db, archived: boolean) => setAccountArchived(db, id, archived, account?.balanceMinor ?? 0));
  const remove = useLedgerMutation((db, _: void) => deleteAccount(db, id));
  const recheck = useLedgerMutation((db, v: { recId: string; adjust: boolean }) => recheckReconciliation(db, v.recId, v.adjust));
  const removeCard = useLedgerMutation((db, cardId: string) => setInstrumentArchived(db, cardId, true));

  if (isLoading) return <Loading />;
  if (!account) return <EmptyState icon="error" title="Location not found" />;

  const business = account.ownership === 'business';
  const tint = business ? c.business : c.primary;
  const balanceAfter = new Map((ledger.data ?? []).map((l) => [l.transactionId, l.balanceAfterMinor]));
  const hasHistory = (ledger.data?.length ?? 0) > 0 || recs.length > 0;
  const canHaveDebitCards = ['bank', 'savings', 'ewallet'].includes(account.kind);
  const isCredit = account.kind === 'credit_card';

  const onError = (e: Error) => Alert.alert('Not possible', e.message);

  return (
    <>
      <Stack.Screen
        options={{
          title: account.name,
          headerRight: () => <IconButton icon="edit" label="Edit location" onPress={() => router.push(`/accounts/${id}/edit`)} />,
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        <Card tone={business ? 'business' : 'primary'} style={{ gap: space.xs }}>
          <Text variant="label" color={tint}>
            {accountKindLabel(account.kind)} · {business ? 'Company money' : 'Personal'}
            {account.isArchived ? ' · Archived' : ''}
          </Text>
          <Text variant="caption" tone="muted">
            {isCredit ? 'Currently owed' : 'Current balance'}
          </Text>
          <Amount
            minor={isCredit ? -account.balanceMinor : account.balanceMinor}
            currency={account.currency}
            variant="display"
            color={isCredit && account.balanceMinor < 0 ? c.negative : undefined}
            colored="negative-only"
          />
          <Text variant="caption" tone="muted">
            Opened {formatDateLabel(account.openingDate)} with {formatMoney(account.openingBalanceMinor, account.currency)}
            {account.institution ? ` · ${account.institution}` : ''}
          </Text>
        </Card>

        {reservedFor.length > 0 && (() => {
          const reserved = reservedFor.reduce((s, a) => s + a.amountMinor, 0);
          const free = account.balanceMinor - reserved;
          return (
            <Card style={{ marginTop: space.sm, gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label" tone="muted">Reserved for goals</Text>
                <Amount minor={reserved} currency={account.currency} variant="label" />
              </Row>
              {reservedFor.map((a) => (
                <Row key={a.goalId} style={{ justifyContent: 'space-between' }}>
                  <Text variant="caption" color={c.primary} onPress={() => router.push(`/goals/${a.goalId}`)}>
                    {a.goal}
                  </Text>
                  <Text variant="caption" tone="muted">{formatMoney(a.amountMinor, account.currency)}</Text>
                </Row>
              ))}
              <Divider />
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label" tone="muted">Unallocated</Text>
                <Amount minor={free} currency={account.currency} variant="label" colored="negative-only" />
              </Row>
              {free < 0 && (
                <Text variant="caption" color={c.warning}>
                  More is reserved than this account holds. Goals only count what is really here.
                </Text>
              )}
            </Card>
          );
        })()}

        {!account.isArchived && (
          <Row style={{ marginTop: space.md, flexWrap: 'wrap' }}>
            <Button compact kind="secondary" icon="remove" label="Expense" onPress={() => router.push(`/entry/expense?account=${id}`)} />
            {!isCredit && (
              <Button compact kind="secondary" icon="add" label="Income" onPress={() => router.push(`/entry/income?account=${id}`)} />
            )}
            <Button compact kind="secondary" icon="swap_horiz" label={isCredit ? 'Pay off' : 'Transfer'} onPress={() => router.push(isCredit ? `/entry/transfer?to=${id}` : `/entry/transfer?from=${id}`)} />
            <Button compact kind="secondary" icon="balance" label="Check balance" onPress={() => router.push(`/accounts/${id}/reconcile`)} />
            <Button compact kind="secondary" icon="show_chart" label="Trend" onPress={() => router.push(`/trends?account=${id}`)} />
          </Row>
        )}

        {canHaveDebitCards && (
          <>
            <SectionHeader
              title="Linked debit cards"
              action={account.isArchived ? undefined : { label: 'Add card', onPress: () => router.push(`/accounts/${id}/card`) }}
            />
            <Card padded={false}>
              {cards.length === 0 ? (
                <View style={{ padding: space.lg }}>
                  <Text variant="label" tone="muted">
                    Paying with a debit card takes money from this account. A card is not extra money, so it has no balance of its own.
                  </Text>
                </View>
              ) : (
                cards.map((card, i) => (
                  <View key={card.id}>
                    {i > 0 && <Divider inset={68} />}
                    <ListItem
                      icon="credit_card"
                      iconColor={tint}
                      title={card.name}
                      subtitle={`Debit card${card.last4 ? ` · •••• ${card.last4}` : ''} · uses this account's balance`}
                      right={
                        <IconButton
                          icon="close"
                          label="Remove card"
                          size={20}
                          onPress={() =>
                            Alert.alert('Remove card?', 'Past payments stay recorded on this account.', [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Remove', style: 'destructive', onPress: () => removeCard.mutate(card.id) },
                            ])
                          }
                        />
                      }
                    />
                  </View>
                ))
              )}
            </Card>
          </>
        )}

        {recs.length > 0 && (
          <>
            <SectionHeader title="Balance checks" />
            <Card padded={false}>
              {recs.slice(0, 5).map((r, i) => {
                const s = STATUS[r.status];
                const color = s.tone === 'positive' ? c.positive : s.tone === 'warning' ? c.warning : c.negative;
                return (
                  <View key={r.id}>
                    {i > 0 && <Divider inset={16} />}
                    <View style={{ padding: space.lg, gap: 4 }}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text variant="bodyStrong">{formatDateLabel(r.date)}</Text>
                        <Text variant="label" color={color}>
                          {s.label}
                        </Text>
                      </Row>
                      <Text variant="caption" tone="muted">
                        Actual {formatMoney(r.statementBalanceMinor, account.currency)} · App {formatMoney(r.calculatedBalanceMinor, account.currency)}
                        {r.differenceMinor !== 0 ? ` · Difference ${formatMoney(r.differenceMinor, account.currency, { sign: 'always' })}` : ''}
                      </Text>
                      {r.note && (
                        <Text variant="caption" tone="faint">
                          {r.note}
                        </Text>
                      )}
                      {r.status === 'open' && (
                        <Row style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
                          <Button
                            compact
                            kind="secondary"
                            label="Re-check"
                            loading={recheck.isPending}
                            onPress={() =>
                              recheck.mutate(
                                { recId: r.id, adjust: false },
                                {
                                  onSuccess: (res) =>
                                    Alert.alert(
                                      res.status === 'matched' ? 'Balances now match' : 'Still different',
                                      res.status === 'matched'
                                        ? 'The recorded transactions now explain the actual balance.'
                                        : `Remaining difference: ${formatMoney(res.differenceMinor, account.currency, { sign: 'always' })}`,
                                    ),
                                  onError,
                                },
                              )
                            }
                          />
                          <Button
                            compact
                            kind="secondary"
                            label="Record adjustment"
                            onPress={() =>
                              Alert.alert(
                                'Record an adjustment?',
                                'This adds an explicit "balance adjustment" entry for the remaining difference. It is not counted as income or spending.',
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  { text: 'Record', onPress: () => recheck.mutate({ recId: r.id, adjust: true }, { onError }) },
                                ],
                              )
                            }
                          />
                        </Row>
                      )}
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        )}

        <SectionHeader title="Activity" />
        <Card padded={false}>
          {(txs.data ?? []).length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text variant="label" tone="muted">
                No activity yet. The balance is the opening balance.
              </Text>
            </View>
          ) : (
            (txs.data ?? []).map((t, i) => (
              <View key={t.id}>
                {i > 0 && <Divider inset={68} />}
                <TransactionRow t={t} accountId={id} balanceAfterMinor={balanceAfter.get(t.id)} />
              </View>
            ))
          )}
        </Card>

        <View style={{ marginTop: space.xxl, gap: space.md }}>
          {account.isArchived ? (
            <Button kind="secondary" icon="unarchive" label="Restore location" onPress={() => archive.mutate(false, { onError })} />
          ) : account.balanceMinor !== 0 ? null : (
            <Button
              kind="secondary"
              icon="archive"
              label="Archive location"
              onPress={() =>
                Alert.alert('Archive this location?', 'It will be hidden from lists. History stays intact.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Archive', onPress: () => archive.mutate(true, { onSuccess: () => closeScreen(), onError }) },
                ])
              }
            />
          )}
          {!hasHistory && (
            <Button
              kind="danger"
              icon="delete"
              label="Delete location"
              onPress={() =>
                Alert.alert('Delete this location?', 'It has no history, so nothing else is affected.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(undefined, { onSuccess: () => closeScreen(), onError }) },
                ])
              }
            />
          )}
          {account.balanceMinor !== 0 && !account.isArchived && (
            <Banner tone="info">Only empty locations can be archived, so money never silently disappears from your totals.</Banner>
          )}
        </View>
      </ScrollView>
    </>
  );
}
