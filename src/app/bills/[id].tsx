import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { OccurrenceRow } from '@/components/occurrence-row';
import { addDays, formatDateLabel, todayISO } from '@/domain/dates';
import { frequencyLabel } from '@/domain/schedule';
import { useLedgerMutation, useOccurrences, useRule } from '@/hooks/data';
import { notify } from '@/lib/confirm';
import { setRulePaused } from '@/services/recurring';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconButton, Loading, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function RuleScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = todayISO();
  const rule = useRule(id);
  const occurrences = useOccurrences({ from: addDays(today, -400), to: addDays(today, 400), ruleId: id }, !!id);
  const pause = useLedgerMutation((db, v: { id: string; paused: boolean }) => setRulePaused(db, v.id, v.paused));

  if (rule.isLoading || occurrences.isLoading) return <Loading />;
  const r = rule.data;
  if (!r) return <EmptyState icon="error" title="Recurring payment not found" message="It may have been deleted." />;
  const list = occurrences.data ?? [];
  const pending = list.filter((o) => o.status === 'pending');
  const overdue = pending.filter((o) => o.overdue);
  const next = pending.filter((o) => !o.overdue).slice(0, 6);
  const history = list.filter((o) => o.status !== 'pending').reverse().slice(0, 24);
  const income = r.direction === 'income';

  return (
    <>
      <Stack.Screen
        options={{
          title: r.name,
          headerRight: () => <IconButton icon="edit" label="Edit recurring payment" onPress={() => router.push(`/bills/edit?id=${r.id}`)} />,
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        <Card tone="primary" style={{ gap: space.xs }}>
          <Text variant="label" color={c.primary}>
            {income ? 'Expected income' : r.debtId ? `Loan installment · ${r.debtName ?? ''}` : 'Bill'} · {frequencyLabel(r.intervalUnit, r.intervalCount)}
          </Text>
          <Amount minor={r.amountMinor} currency={r.currency} variant="title" color={income ? c.positive : undefined} />
          <Text variant="caption" tone="muted">
            {income ? 'Received into' : 'Paid from'} {r.accountName}
            {r.categoryName ? ` · ${r.categoryName}` : ''}
            {r.payee ? ` · ${r.payee}` : ''}
          </Text>
          <Text variant="caption" tone="muted">
            {r.isPaused ? 'Paused: nothing is due or reserved.' : r.next ? `Next due ${formatDateLabel(r.next.dueDate)}` : 'No more dates (ended).'}
            {r.endDate ? ` · ends ${formatDateLabel(r.endDate)}` : ''}
            {!income ? (r.reserve ? ' · reserved in My Money' : ' · not reserved') : ''}
          </Text>
        </Card>
        {r.accountArchived && (
          <View style={{ marginTop: space.md }}>
            <Banner tone="warning">{`${r.accountName} is archived. Edit this payment to choose another location.`}</Banner>
          </View>
        )}
        {r.notes && (
          <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
            {r.notes}
          </Text>
        )}

        {overdue.length > 0 && (
          <>
            <SectionHeader title={`Overdue · ${overdue.length}`} />
            <Card padded={false}>
              {overdue.map((o, i) => (
                <View key={o.key}>
                  {i > 0 && <Divider inset={68} />}
                  <OccurrenceRow o={o} showName={false} />
                </View>
              ))}
            </Card>
          </>
        )}

        {!r.isPaused && (
          <>
            <SectionHeader title="Coming up" />
            <Card padded={false}>
              {next.length === 0 ? (
                <View style={{ padding: space.lg }}>
                  <Text tone="muted">No upcoming dates.</Text>
                </View>
              ) : (
                next.map((o, i) => (
                  <View key={o.key}>
                    {i > 0 && <Divider inset={68} />}
                    <OccurrenceRow o={o} showName={false} />
                  </View>
                ))
              )}
            </Card>
          </>
        )}

        <SectionHeader title="History" />
        <Card padded={false}>
          {history.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text tone="muted">Nothing paid or skipped yet.</Text>
            </View>
          ) : (
            history.map((o, i) => (
              <View key={o.key}>
                {i > 0 && <Divider inset={68} />}
                <OccurrenceRow o={o} showName={false} />
              </View>
            ))
          )}
        </Card>

        <View style={{ marginTop: space.xl }}>
          <Button
            kind="secondary"
            icon={r.isPaused ? 'play_arrow' : 'pause'}
            label={r.isPaused ? 'Resume' : 'Pause'}
            loading={pause.isPending}
            onPress={() => pause.mutate({ id: r.id, paused: !r.isPaused }, { onError: (e) => notify('Not possible', e.message) })}
          />
        </View>
      </ScrollView>
    </>
  );
}
