import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BarRow } from '@/components/breakdown';
import { ColumnChart } from '@/components/charts';
import { InsightList } from '@/components/insight-list';
import { endOfMonth, formatDateLabel, formatMonthLabel, PERIOD_LABELS, presetRange, todayISO, type DateRange, type PeriodPreset } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useCompany, useCompanyAnalytics, useCompanyDashboard, useFiscalYears } from '@/hooks/data';
import { openTransactions } from '@/lib/drill';
import { drillFilter, type AnalyticsFilter, type BreakdownRow, type Dimension } from '@/services/analytics';
import { companyInsights, pnlBreakdown, pnlScope } from '@/services/company-analytics';
import { Amount, Banner, Button, Card, Chip, EmptyState, Loading, Row, SectionHeader, Segmented, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const PRESETS: PeriodPreset[] = ['this_month', 'last_month', 'last_90', 'this_year', 'last_year'];

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'subcategory', label: 'Subcategory' },
  { value: 'merchant', label: 'Merchant / client' },
  { value: 'tag', label: 'Tag' },
  { value: 'account', label: 'Location' },
];

type Side = 'expenses' | 'revenue';
type Series = 'revenueMinor' | 'costsMinor' | 'profitMinor';

function Item({ row, max, total, onOpen, onFilter }: { row: BreakdownRow; max: number; total: number; onOpen: (() => void) | null; onFilter: (() => void) | null }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityHint="Shows actions for this row">
        <BarRow label={row.label} minor={row.totalMinor} max={max} color={row.color ?? c.business} detail={`${total ? Math.round((row.totalMinor / total) * 100) : 0}% · ${row.count}×`} />
      </Pressable>
      {open && (
        <Row style={{ flexWrap: 'wrap' }}>
          {onOpen && <Button compact kind="secondary" icon="receipt_long" label={`Show ${row.count} transaction${row.count > 1 ? 's' : ''}`} onPress={onOpen} />}
          {onFilter && <Button compact kind="ghost" icon="filter_alt" label="Analyse only this" onPress={onFilter} />}
        </Row>
      )}
    </View>
  );
}

export default function CompanyAnalyticsScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const company = useCompany(id);
  const years = useFiscalYears(id);
  const dash = useCompanyDashboard(id);
  const [period, setPeriod] = useState<string>('this_year');
  const [side, setSide] = useState<Side>('expenses');
  const [dimension, setDimension] = useState<Dimension>('category');
  const [filter, setFilter] = useState<AnalyticsFilter | null>(null);
  const [series, setSeries] = useState<Series>('profitMinor');

  const fy = (years.data ?? []).find((y) => y.id === period);
  const today = todayISO();
  const range: DateRange = fy ? { from: fy.startDate, to: fy.endDate < today ? fy.endDate : today } : presetRange(period as PeriodPreset);
  const q = useCompanyAnalytics(id, range);

  if (company.isLoading) return <Loading />;
  if (!company.data) return <EmptyState icon="error" title="Company not found" />;
  const companyId = company.data.id;
  const data = q.data;
  const pnl = data?.pnl;
  const split = pnl ? pnlBreakdown(pnl, side, dimension, filter) : null;
  const scope = pnlScope(companyId, side);
  const insights = pnl && data ? companyInsights({ companyId, pnl, monthly: data.monthly, dashboard: dash.data ?? null }) : [];
  const points = (data?.monthly ?? []).map((m) => ({ label: formatMonthLabel(m.month).slice(0, 3) + ' ' + m.month.slice(2, 4), value: Math.max(0, m[series]) }));

  const changeSide = (s: Side) => {
    setSide(s);
    setFilter(null);
  };

  return (
    <>
      <Stack.Screen options={{ title: `${company.data.name} · analytics` }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
          {(years.data ?? []).map((y) => (
            <Chip key={y.id} label={`FY ${y.label}`} selected={period === y.id} onPress={() => setPeriod(y.id)} color={c.business} />
          ))}
          {PRESETS.map((p) => (
            <Chip key={p} label={PERIOD_LABELS[p]} selected={period === p} onPress={() => setPeriod(p)} color={c.business} />
          ))}
        </ScrollView>
        <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
          {formatDateLabel(range.from)} – {formatDateLabel(range.to)} · as recorded{company.data.tvaMode === 'ttc' ? ' (TVA included)' : ''}, cash
          basis, before IS. Rule-based figures — no AI.
        </Text>

        {!pnl ? (
          <Loading />
        ) : (
          <>
            <View style={styles.grid}>
              <Card style={styles.cell}>
                <Text variant="caption" tone="muted">Revenue</Text>
                <Amount minor={pnl.revenue.totalMinor} variant="heading" color={c.positive} />
              </Card>
              <Card style={styles.cell}>
                <Text variant="caption" tone="muted">Costs</Text>
                <Amount minor={pnl.costsMinor} variant="heading" color={c.negative} />
              </Card>
              <Card style={[styles.cell, { flexBasis: '100%' }]}>
                <Text variant="caption" tone="muted">Recorded profit before tax</Text>
                <Amount minor={pnl.profitMinor} variant="heading" sign="always" colored="negative-only" />
                <Text variant="caption" tone="faint">Not the bank balance, and not distributable profit — see the tax estimate.</Text>
              </Card>
            </View>
            {pnl.unconvertedCurrencies.length > 0 && (
              <View style={{ marginTop: space.sm }}>
                <Banner tone="warning">{`Activity in ${pnl.unconvertedCurrencies.join(', ')} is excluded — add an exchange rate in Settings.`}</Banner>
              </View>
            )}

            {insights.length > 0 && (
              <>
                <SectionHeader title="Insights" />
                <InsightList insights={insights} />
              </>
            )}

            <SectionHeader title="Breakdown" />
            <Segmented
              options={[
                { value: 'expenses', label: 'Costs' },
                { value: 'revenue', label: 'Revenue' },
              ]}
              value={side}
              onChange={changeSide}
              tint={c.business}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: space.md }}>
              {DIMENSIONS.filter((d) => d.value !== filter?.kind).map((d) => (
                <Chip key={d.value} label={d.label} selected={dimension === d.value} onPress={() => setDimension(d.value)} color={c.textMuted} />
              ))}
            </ScrollView>
            {filter && (
              <Card tone="business" style={{ marginBottom: space.sm }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="label" color={c.business} style={{ flex: 1 }}>
                    Only: {filter.label}
                  </Text>
                  <Button compact kind="ghost" label="Clear" onPress={() => setFilter(null)} />
                </Row>
              </Card>
            )}
            {!split || split.rows.length === 0 ? (
              <Card>
                <Text tone="muted">{side === 'revenue' ? 'No revenue' : 'No expenses'} recorded in this period.</Text>
              </Card>
            ) : (
              <Card style={{ gap: space.lg }}>
                {split.overlapping && (
                  <Text variant="caption" tone="muted">
                    Rows overlap (several tags); the total {formatMoney(split.totalMinor)} counts each transaction once.
                  </Text>
                )}
                {split.rows.map((row) => {
                  const drill = drillFilter(range, filter, row.drill, scope);
                  return (
                    <Item
                      key={row.key}
                      row={row}
                      max={split.rows[0].totalMinor}
                      total={split.totalMinor}
                      onOpen={drill ? () => openTransactions(drill, filter ? `${filter.label} · ${row.label}` : row.label) : null}
                      onFilter={
                        !filter && row.filter
                          ? () => {
                              setFilter(row.filter);
                              setDimension(row.filter?.kind === 'category' ? 'subcategory' : 'category');
                            }
                          : null
                      }
                    />
                  );
                })}
              </Card>
            )}
            {side === 'expenses' && pnl.expenseTransfers.groups.length > 0 && !filter && (
              <Card style={{ marginTop: space.sm, gap: space.md }}>
                {pnl.expenseTransfers.groups.map((g) => (
                  <Pressable key={g.key} onPress={() => openTransactions(g.drill, g.label)} accessibilityRole="button">
                    <BarRow label={g.label} minor={g.amountMinor} max={Math.max(g.amountMinor, split?.rows[0]?.totalMinor ?? 0)} color={c.business} detail={`${g.count}×`} />
                  </Pressable>
                ))}
                <Text variant="caption" tone="faint">Also company costs; on your side they are personal income or refunds.</Text>
              </Card>
            )}

            <SectionHeader title="Month over month · last 12 months" />
            <Card style={{ gap: space.md }}>
              <Segmented
                options={[
                  { value: 'profitMinor', label: 'Profit' },
                  { value: 'revenueMinor', label: 'Revenue' },
                  { value: 'costsMinor', label: 'Costs' },
                ]}
                value={series}
                onChange={setSeries}
                tint={c.business}
              />
              <ColumnChart key={series} points={points} color={c.business} />
              <View style={{ gap: 2 }}>
                {[...(data?.monthly ?? [])].reverse().slice(0, 6).map((m) => (
                  <Pressable
                    key={m.month}
                    accessibilityRole="button"
                    onPress={() => openTransactions({ from: m.month, to: endOfMonth(m.month), companyId, ownership: 'business' }, formatMonthLabel(m.month))}
                    style={({ pressed }) => [styles.month, { borderColor: c.border }, pressed && { opacity: 0.7 }]}>
                    <Text variant="label" style={{ flex: 1 }}>{formatMonthLabel(m.month)}</Text>
                    <Text variant="caption" tone="muted">{formatMoney(m.revenueMinor)} − {formatMoney(m.costsMinor)} =</Text>
                    <Amount minor={m.profitMinor} variant="label" colored="negative-only" />
                  </Pressable>
                ))}
              </View>
              {series === 'profitMinor' && (data?.monthly ?? []).some((m) => m.profitMinor < 0) && (
                <Text variant="caption" tone="faint">Months with a loss show no column; their figure is in the list.</Text>
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { flexBasis: '47%', flexGrow: 1, gap: 2 },
  month: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
});
