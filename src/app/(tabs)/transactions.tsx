import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { TransactionRow } from '@/components/transaction-row';
import { formatDateLabel, PERIOD_LABELS, presetRange, type PeriodPreset } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import type { TransactionKind } from '@/domain/types';
import { useTransactions } from '@/hooks/data';
import { useUiStore } from '@/hooks/ui-store';
import { CLEAR_DRILL, decodeDrill, type DrillParams } from '@/lib/drill';
import { TextField } from '@/ui/fields';
import { Icon } from '@/ui/icon';
import { TabScreen } from '@/ui/layout';
import { Button, Card, Chip, Divider, EmptyState, Loading, Row, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const PERIODS: (PeriodPreset | 'all')[] = ['all', 'today', 'this_week', 'this_month', 'last_month', 'last_30', 'this_year'];
const KINDS: { value: TransactionKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'adjustment', label: 'Adjustments' },
  { value: 'debt', label: 'Loans' },
];
const PAGE = 100;

export default function TransactionsScreen() {
  const c = useColors();
  const params = useLocalSearchParams<DrillParams>();
  const period = useUiStore((s) => s.transactionsPeriod);
  const setPeriod = useUiStore((s) => s.setTransactionsPeriod);
  const [kind, setKind] = useState<TransactionKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const drill = decodeDrill(params);
  const range = drill ? {} : period === 'all' ? {} : presetRange(period);
  const { data, isLoading, refetch, isRefetching } = useTransactions({
    ...range,
    ...drill,
    kinds: kind === 'all' ? drill?.kinds : [kind],
    search: search.trim() || undefined,
    limit,
  });

  const groups: { date: string; items: NonNullable<typeof data> }[] = [];
  for (const t of data ?? []) {
    const last = groups[groups.length - 1];
    if (last?.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  return (
    <TabScreen title="Activity" refreshing={isRefetching} onRefresh={refetch}>
      <TextField
        placeholder="Search merchant, note, item, category"
        value={search}
        onChangeText={setSearch}
        leading={<Icon name="search" size={20} color={c.textFaint} />}
        returnKeyType="search"
      />

      {drill ? (
        <Card tone="primary" style={{ marginBottom: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label" color={c.primary} style={{ flex: 1 }}>
              {params.label || 'Filtered'}
              {drill.from && drill.to ? ` · ${formatDateLabel(drill.from)} – ${formatDateLabel(drill.to)}` : ''}
            </Text>
            <Button compact kind="ghost" label="Clear" onPress={() => router.setParams(CLEAR_DRILL)} />
          </Row>
        </Card>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.sm }}>
          {PERIODS.map((p) => (
            <Chip key={p} label={p === 'all' ? 'All time' : PERIOD_LABELS[p]} selected={period === p} onPress={() => setPeriod(p)} />
          ))}
        </ScrollView>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
        {KINDS.map((k) => (
          <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} color={c.textMuted} />
        ))}
      </ScrollView>

      {isLoading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="receipt_long"
            title={search || kind !== 'all' || period !== 'all' || drill ? 'Nothing matches' : 'No transactions yet'}
            message={search || kind !== 'all' || period !== 'all' || drill ? 'Try another filter or search.' : 'Tap + to record an expense, income or transfer.'}
          />
        </Card>
      ) : (
        <>
          {groups.map((g) => {
            const spent = g.items.filter((t) => t.kind === 'expense' && t.account?.ownership === 'personal' && t.currency === 'MAD').reduce((s, t) => s + t.amountMinor, 0);
            return (
              <View key={g.date} style={{ marginBottom: space.md }}>
                <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.xs, marginBottom: space.xs }}>
                  <Text variant="overline" tone="muted">
                    {formatDateLabel(g.date)}
                  </Text>
                  {spent > 0 && (
                    <Text variant="caption" tone="muted">
                      Spent {formatMoney(spent)}
                    </Text>
                  )}
                </Row>
                <Card padded={false}>
                  {g.items.map((t, i) => (
                    <View key={t.id}>
                      {i > 0 && <Divider inset={68} />}
                      <TransactionRow t={t} />
                    </View>
                  ))}
                </Card>
              </View>
            );
          })}
          {(data?.length ?? 0) >= limit && <Button kind="secondary" label="Load more" onPress={() => setLimit((l) => l + PAGE)} />}
        </>
      )}
    </TabScreen>
  );
}
