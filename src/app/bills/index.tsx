import { router, Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { OccurrenceRow } from '@/components/occurrence-row';
import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { frequencyLabel } from '@/domain/schedule';
import { useMoneySummary, useRules, useUpcoming } from '@/hooks/data';
import { RESERVE_HORIZON_DAYS } from '@/services/recurring';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconButton, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function BillsScreen() {
  const c = useColors();
  const upcoming = useUpcoming();
  const rules = useRules();
  const summary = useMoneySummary();

  if (upcoming.isLoading || rules.isLoading) return <Loading />;
  const items = upcoming.data ?? [];
  const all = rules.data ?? [];
  const bills = items.filter((o) => o.direction === 'expense');
  const income = items.filter((o) => o.direction === 'income');
  const overdue = bills.filter((o) => o.overdue);
  const p = summary.data?.personal;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => <IconButton icon="add" label="New recurring payment" onPress={() => router.push('/bills/edit')} />,
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        {all.length === 0 && items.length === 0 ? (
          <Card>
            <EmptyState
              icon="event_repeat"
              title="Plan bills and expected income"
              message="Add internet, electricity, insurance, a loan installment or your salary. Expected money never changes a balance: only what you mark paid is recorded."
              action={{ label: 'Add recurring payment', onPress: () => router.push('/bills/edit') }}
            />
            <Button kind="ghost" label="Add a one-off expected payment" onPress={() => router.push('/bills/edit?once=1')} />
          </Card>
        ) : (
          <>
            {p && p.reservationsApply && (
              <Card tone="primary" style={{ gap: space.xs }}>
                <Text variant="label" color={c.primary}>
                  Reserved for bills (next {RESERVE_HORIZON_DAYS} days and overdue)
                </Text>
                <Amount minor={p.reservedBills} variant="title" />
                <Text variant="caption" tone="muted">
                  Part of your money, set aside on the location each bill is paid from (after goals). Paying a bill lowers the balance and
                  the reservation together.
                </Text>
                {p.expectedIncome > 0 && (
                  <Text variant="caption" tone="muted">
                    Expected income in the same period: {formatMoney(p.expectedIncome)} — not counted until you record it.
                  </Text>
                )}
              </Card>
            )}
            {p && p.billsShort.length > 0 && (
              <View style={{ marginTop: space.md }}>
                <Banner tone="warning" title="Not enough money for upcoming bills">
                  {p.billsShort
                    .map((b) => `${b.account.name}: ${formatMoney(b.dueMinor, b.account.currency)} due, ${formatMoney(b.shortMinor, b.account.currency)} short after goal reservations.`)
                    .join('\n')}
                </Banner>
              </View>
            )}
            {overdue.length > 0 && (
              <View style={{ marginTop: space.md }}>
                <Banner tone="danger" title={`${overdue.length} overdue`}>
                  Mark them paid (or link the payment you already recorded), or skip them if they will not be paid.
                </Banner>
              </View>
            )}

            <SectionHeader title={`Bills due · next ${RESERVE_HORIZON_DAYS} days`} />
            <Card padded={false}>
              {bills.length === 0 ? (
                <View style={{ padding: space.lg }}>
                  <Text tone="muted">Nothing due.</Text>
                </View>
              ) : (
                bills.map((o, i) => (
                  <View key={o.key}>
                    {i > 0 && <Divider inset={68} />}
                    <OccurrenceRow o={o} />
                  </View>
                ))
              )}
            </Card>

            {income.length > 0 && (
              <>
                <SectionHeader title="Expected income" />
                <Card padded={false}>
                  {income.map((o, i) => (
                    <View key={o.key}>
                      {i > 0 && <Divider inset={68} />}
                      <OccurrenceRow o={o} />
                    </View>
                  ))}
                </Card>
              </>
            )}

            <SectionHeader title="Recurring" action={{ label: 'Add', onPress: () => router.push('/bills/edit') }} />
            <Card padded={false}>
              {all.length === 0 ? (
                <View style={{ padding: space.lg }}>
                  <Text tone="muted">No recurring payments yet.</Text>
                </View>
              ) : (
                all.map((r, i) => (
                  <View key={r.id}>
                    {i > 0 && <Divider inset={68} />}
                    <ListItem
                      icon={r.debtId ? 'handshake' : (r.categoryIcon ?? (r.direction === 'income' ? 'add_card' : 'event_repeat'))}
                      iconColor={r.isPaused ? c.textFaint : (r.categoryColor ?? (r.direction === 'income' ? c.positive : c.primary))}
                      title={r.name}
                      subtitle={[
                        frequencyLabel(r.intervalUnit, r.intervalCount),
                        r.isPaused ? 'paused' : r.next ? `next ${formatDateLabel(r.next.dueDate)}` : 'ended',
                        r.overdueCount > 0 ? `${r.overdueCount} overdue` : null,
                        r.accountName,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      right={<Amount minor={r.amountMinor} currency={r.currency} color={r.direction === 'income' ? c.positive : undefined} />}
                      onPress={() => router.push(`/bills/${r.id}`)}
                    />
                  </View>
                ))
              )}
            </Card>
            <Row style={{ marginTop: space.md, flexWrap: 'wrap' }}>
              <Button kind="secondary" icon="add" label="Recurring payment" onPress={() => router.push('/bills/edit')} />
              <Button kind="ghost" icon="event" label="One-off expected payment" onPress={() => router.push('/bills/edit?once=1')} />
            </Row>
            <Text variant="caption" tone="muted" style={{ marginTop: space.lg }}>
              Expected payments are plans. Balances change only when a payment is recorded. Reminders appear here and on Home; phone
              notifications come later.
            </Text>
          </>
        )}
      </ScrollView>
    </>
  );
}
