import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { LineChart } from '@/components/charts';
import { bucketLabel, bucketRange, formatDateLabel, todayISO, trendDates, type Granularity } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useAccounts, useBalanceHistory } from '@/hooks/data';
import { useUiStore } from '@/hooks/ui-store';
import { openTransactions } from '@/lib/drill';
import { ChipGroup } from '@/ui/fields';
import { Card, Chip, Divider, Loading, Row, SectionHeader, Segmented, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const TREND: { value: Granularity; label: string; count: number }[] = [
  { value: 'day', label: 'Daily', count: 30 },
  { value: 'week', label: 'Weekly', count: 12 },
  { value: 'month', label: 'Monthly', count: 12 },
  { value: 'year', label: 'Yearly', count: 5 },
];

type Series = 'liquid' | 'net' | string;

export default function TrendsScreen() {
  const c = useColors();
  const params = useLocalSearchParams<{ account?: string }>();
  const granularity = useUiStore((s) => s.trendGranularity);
  const setGranularity = useUiStore((s) => s.setTrendGranularity);
  const [series, setSeries] = useState<Series>(params.account ?? 'liquid');
  const [index, setIndex] = useState<number | null>(null);
  const accounts = useAccounts(true).data ?? [];
  const trend = TREND.find((t) => t.value === granularity)!;
  const { data } = useBalanceHistory(trendDates(trend.value, trend.count, todayISO()));

  const account = accounts.find((a) => a.id === series);
  const currency = account?.currency;
  // A location is only plotted from its opening date: before that it did not exist (not "0 DH").
  const shown = (data ?? []).filter((p) => !account || p.accounts[account.id] !== undefined);
  const dates = shown.map((p) => p.date);
  const points = shown.map((p) => ({
    label: bucketLabel(trend.value, p.date),
    value: series === 'liquid' ? p.liquid : series === 'net' ? p.netLiquid : p.accounts[series],
  }));
  const selected = index === null || index >= points.length ? points.length - 1 : index;
  const fmt = (v: number) => formatMoney(v, currency);
  const tint = account?.ownership === 'business' ? c.business : c.primary;

  const drill = (i: number) => {
    const r = bucketRange(trend.value, dates[i]);
    openTransactions(
      account ? { ...r, accountId: account.id } : { ...r, ownership: 'personal' },
      `${account?.name ?? 'Personal'} · ${points[i].label}`,
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
      <Segmented
        options={TREND.map((t) => ({ value: t.value, label: t.label }))}
        value={trend.value}
        onChange={(g) => {
          setGranularity(g);
          setIndex(null);
        }}
      />
      <View style={{ marginTop: space.md }}>
        <ChipGroup>
          <Chip label="Personal money" selected={series === 'liquid'} onPress={() => setSeries('liquid')} />
          <Chip label="Net after debts" selected={series === 'net'} onPress={() => setSeries('net')} />
          {accounts.map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              color={a.ownership === 'business' ? c.business : undefined}
              selected={series === a.id}
              onPress={() => setSeries(a.id)}
            />
          ))}
        </ChipGroup>
      </View>

      <Card style={{ marginTop: space.md }}>
        {!data ? (
          <Loading />
        ) : points.length === 0 ? (
          <Text tone="muted">This location did not exist yet in this period.</Text>
        ) : (
          <LineChart
            points={points}
            color={tint}
            format={fmt}
            selected={selected}
            onSelect={setIndex}
            footer={
              <Text variant="caption" color={c.primary} onPress={() => drill(selected)}>
                End of {formatDateLabel(dates[selected])} · show activity →
              </Text>
            }
          />
        )}
      </Card>
      <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
        Each point is the balance at the end of that {trend.value} (today for the current one), recalculated from recorded transactions — the
        same calculation as My Money on a past date. {account ? (account.ownership === 'business' ? 'Company money, not personal.' : '') : 'Company money is not included.'}
      </Text>

      <SectionHeader title="Values" />
      <Card padded={false}>
        {[...points].reverse().map((p, i) => {
          const real = points.length - 1 - i;
          return (
            <View key={dates[real]}>
              {i > 0 && <Divider inset={space.lg} />}
              <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md }}>
                <Text variant="label" onPress={() => drill(real)}>
                  {p.label}
                </Text>
                <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>
                  {fmt(p.value)}
                </Text>
              </Row>
            </View>
          );
        })}
      </Card>
    </ScrollView>
  );
}
