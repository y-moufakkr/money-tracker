import { router, Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useDebts, useMoneySummary } from '@/hooks/data';
import type { Debt } from '@/services/debts';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconButton, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

function statusLine(d: Debt): string {
  const parts = [
    d.status === 'paid' ? 'Repaid' : d.status === 'closed' ? 'Closed' : d.status === 'partial' ? `${formatMoney(d.paidMinor, d.currency)} repaid` : 'Not repaid yet',
  ];
  if (d.overdue) parts.push(`overdue since ${formatDateLabel(d.dueDate!)}`);
  else if (d.dueDate && d.outstandingMinor > 0) parts.push(`due ${formatDateLabel(d.dueDate)}`);
  return parts.join(' · ');
}

function DebtList({ debts }: { debts: Debt[] }) {
  const c = useColors();
  return (
    <Card padded={false}>
      {debts.map((d, i) => (
        <View key={d.id}>
          {i > 0 && <Divider inset={68} />}
          <ListItem
            icon={d.direction === 'owe' ? 'call_made' : 'call_received'}
            iconColor={d.outstandingMinor === 0 ? c.textFaint : d.direction === 'owe' ? c.negative : c.primary}
            title={d.counterparty}
            subtitle={
              <Text variant="caption" color={d.overdue ? c.negative : d.dueSoon ? c.warning : c.textMuted} numberOfLines={1}>
                {statusLine(d)}
              </Text>
            }
            right={
              <View style={{ alignItems: 'flex-end' }}>
                <Amount minor={d.outstandingMinor} currency={d.currency} color={d.outstandingMinor === 0 ? c.textFaint : undefined} />
                {d.outstandingMinor !== d.principalMinor && (
                  <Text variant="caption" tone="faint">
                    of {formatMoney(d.principalMinor, d.currency)}
                  </Text>
                )}
              </View>
            }
            onPress={() => router.push(`/debts/${d.id}`)}
          />
        </View>
      ))}
    </Card>
  );
}

export default function DebtsScreen() {
  const c = useColors();
  const q = useDebts();
  const summary = useMoneySummary();
  if (q.isLoading) return <Loading />;
  const debts = q.data ?? [];
  const p = summary.data?.personal;
  const owe = debts.filter((d) => d.direction === 'owe');
  const owed = debts.filter((d) => d.direction === 'owed');
  const active = (l: Debt[]) => l.filter((d) => d.outstandingMinor > 0);
  const settled = debts.filter((d) => d.outstandingMinor === 0);

  return (
    <>
      <Stack.Screen options={{ headerRight: () => <IconButton icon="add" label="New debt" onPress={() => router.push('/debts/edit')} /> }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        {debts.length === 0 ? (
          <Card>
            <EmptyState
              icon="handshake"
              title="Debts and money owed to you"
              message="Track loans, money you borrowed or lent, and purchases on credit. A loan is never counted as income or spending, and money owed to you is never counted as cash."
              action={{ label: 'Record money I owe', onPress: () => router.push('/debts/edit?direction=owe') }}
            />
            <Button kind="ghost" label="Record money owed to me" onPress={() => router.push('/debts/edit?direction=owed')} />
          </Card>
        ) : (
          <>
            {p && (
              <Row style={{ gap: space.sm }}>
                <Card style={{ flex: 1, gap: 2 }}>
                  <Text variant="caption" tone="muted">
                    I owe
                  </Text>
                  <Amount minor={p.debtLiabilities} variant="heading" color={p.debtLiabilities > 0 ? c.negative : undefined} />
                  <Text variant="caption" tone="faint">
                    In liabilities, with cards
                  </Text>
                </Card>
                <Card style={{ flex: 1, gap: 2 }}>
                  <Text variant="caption" tone="muted">
                    Owed to me
                  </Text>
                  <Amount minor={p.receivables} variant="heading" />
                  <Text variant="caption" tone="faint">
                    Not cash until repaid
                  </Text>
                </Card>
              </Row>
            )}
            {p && p.unconvertedDebts > 0 && (
              <View style={{ marginTop: space.md }}>
                <Banner tone="warning">{`${p.unconvertedDebts} debt(s) in a currency with no exchange rate are not in these totals.`}</Banner>
              </View>
            )}

            <SectionHeader title="I owe" action={{ label: 'Add', onPress: () => router.push('/debts/edit?direction=owe') }} />
            {active(owe).length === 0 ? (
              <Text tone="muted">Nothing outstanding.</Text>
            ) : (
              <DebtList debts={active(owe)} />
            )}
            <SectionHeader title="Owed to me" action={{ label: 'Add', onPress: () => router.push('/debts/edit?direction=owed') }} />
            {active(owed).length === 0 ? <Text tone="muted">Nothing outstanding.</Text> : <DebtList debts={active(owed)} />}
            {settled.length > 0 && (
              <>
                <SectionHeader title="Repaid or closed" />
                <DebtList debts={settled} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}
