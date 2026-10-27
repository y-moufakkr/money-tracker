import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BudgetCard } from '@/components/budget-card';
import { Breakdown as StackedBar, BarRow } from '@/components/breakdown';
import { LineChart } from '@/components/charts';
import { InsightList } from '@/components/insight-list';
import {
  addDays,
  addMonths,
  bucketLabel,
  bucketRange,
  daysBetweenInclusive,
  daysInMonth,
  formatDateLabel,
  PERIOD_LABELS,
  presetRange,
  todayISO,
  trendDates,
  type DateRange,
  type Granularity,
  type PeriodPreset,
} from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useBalanceHistory, useBudgetStatuses, useExpenseFacts, useInsights, usePeriodSummary } from '@/hooks/data';
import { useUiStore, type AnalyticsPeriod } from '@/hooks/ui-store';
import { openTransactions } from '@/lib/drill';
import { applyFilter, breakdown, drillFilter, type BreakdownRow, type Dimension } from '@/services/analytics';
import { DateButton } from '@/ui/fields';
import { TabScreen } from '@/ui/layout';
import { Amount, Banner, Button, Card, Chip, Divider, EmptyState, ListItem, Loading, Row, SectionHeader, Segmented, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const PRESETS: PeriodPreset[] = ['this_week', 'last_week', 'this_month', 'last_month', 'last_30', 'last_90', 'this_year', 'last_year'];

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'subcategory', label: 'Subcategory' },
  { value: 'tag', label: 'Tag' },
  { value: 'merchant', label: 'Merchant' },
  { value: 'product', label: 'Product' },
  { value: 'account', label: 'Location' },
  { value: 'essential', label: 'Essential' },
];

const TREND: { value: Granularity; label: string; count: number }[] = [
  { value: 'day', label: 'Daily', count: 30 },
  { value: 'week', label: 'Weekly', count: 12 },
  { value: 'month', label: 'Monthly', count: 12 },
  { value: 'year', label: 'Yearly', count: 5 },
];

/**
 * The comparison period. "To date" periods are compared with the same number
 * of days at the start of the previous period, so partial months stay fair.
 */
function previousRange(preset: AnalyticsPeriod, range: DateRange): { range: DateRange; label: string } {
  const len = daysBetweenInclusive(range.from, range.to);
  if (preset === 'this_month' || preset === 'last_month') {
    const from = addMonths(range.from, -1);
    const full = preset === 'last_month' || len >= daysInMonth(range.from);
    const to = full ? addDays(range.from, -1) : addDays(from, Math.min(len, daysInMonth(from)) - 1);
    return { range: { from, to }, label: full ? 'previous month' : `first ${len} days of previous month` };
  }
  if (preset === 'this_year' || preset === 'last_year') {
    const from = `${Number(range.from.slice(0, 4)) - 1}${range.from.slice(4)}`;
    const to = `${Number(range.to.slice(0, 4)) - 1}${range.to.slice(4)}`.replace(/-02-29$/, '-02-28');
    return { range: { from, to }, label: preset === 'this_year' ? 'same dates last year' : 'year before' };
  }
  return { range: { from: addDays(range.from, -len), to: addDays(range.from, -1) }, label: `previous ${len} days` };
}

function Change({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  const c = useColors();
  if (before === 0) return <Text variant="caption" tone="faint">no data to compare</Text>;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  const good = invert ? pct <= 0 : pct >= 0;
  return (
    <Text variant="caption" color={pct === 0 ? c.textMuted : good ? c.positive : c.negative}>
      {pct > 0 ? '▲' : pct < 0 ? '▼' : '='} {Math.abs(pct)}%
    </Text>
  );
}

function BreakdownItem({
  row,
  max,
  total,
  before,
  canFilter,
  onFilter,
  onOpen,
}: {
  row: BreakdownRow;
  max: number;
  total: number;
  before: number | undefined;
  canFilter: boolean;
  onFilter: () => void;
  onOpen: (() => void) | null;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const share = total ? Math.round((row.totalMinor / total) * 100) : 0;
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Shows actions for this row"
        onPress={() => setOpen((v) => !v)}
        style={{ gap: 2 }}>
        <BarRow
          label={row.label}
          minor={row.totalMinor}
          max={max}
          color={row.color ?? c.primary}
          detail={`${share}% · ${row.count}×`}
        />
        {before !== undefined && (
          <Row style={{ justifyContent: 'flex-end' }}>
            <Change now={row.totalMinor} before={before} invert />
          </Row>
        )}
      </Pressable>
      {open && (
        <Row style={{ flexWrap: 'wrap' }}>
          {onOpen && <Button compact kind="secondary" icon="receipt_long" label={`Show ${row.count} transaction${row.count > 1 ? 's' : ''}`} onPress={onOpen} />}
          {canFilter && <Button compact kind="ghost" icon="filter_alt" label="Analyse only this" onPress={onFilter} />}
          {!onOpen && !canFilter && (
            <Text variant="caption" tone="muted">
              No single list of transactions matches this row.
            </Text>
          )}
        </Row>
      )}
    </View>
  );
}

export default function AnalyticsScreen() {
  const c = useColors();
  const today = todayISO();
  const ui = useUiStore();
  const range = ui.analyticsPeriod === 'custom' ? ui.analyticsCustom : presetRange(ui.analyticsPeriod);
  const prev = previousRange(ui.analyticsPeriod, range);
  const current = usePeriodSummary(range);
  const before = usePeriodSummary(prev.range);
  const facts = useExpenseFacts(range);
  const prevFacts = useExpenseFacts(prev.range);
  const insights = useInsights();
  const budgets = useBudgetStatuses();
  const trend = TREND.find((t) => t.value === ui.trendGranularity)!;
  const trendDays = trendDates(trend.value, trend.count, today);
  const history = useBalanceHistory(trendDays);
  const [trendIndex, setTrendIndex] = useState<number | null>(null);

  const s = current.data;
  const p = before.data;
  const calendarDays = daysBetweenInclusive(range.from, range.to < today ? range.to : today);
  const refresh = () => {
    current.refetch();
    before.refetch();
    facts.refetch();
    prevFacts.refetch();
    insights.refetch();
    budgets.refetch();
    history.refetch();
  };

  const filter = ui.analyticsFilter;
  const scoped = facts.data ? applyFilter(facts.data.facts, filter) : [];
  const split = facts.data ? breakdown(scoped, ui.analyticsDimension, facts.data.tags) : null;
  const prevSplit = prevFacts.data ? breakdown(applyFilter(prevFacts.data.facts, filter), ui.analyticsDimension, prevFacts.data.tags) : null;
  const essential = facts.data ? breakdown(scoped, 'essential', facts.data.tags) : null;
  const points = (history.data ?? []).map((pt) => ({ label: bucketLabel(trend.value, pt.date), value: pt.liquid }));
  const selectedTrend = trendIndex === null || trendIndex >= points.length ? points.length - 1 : trendIndex;

  const choosePreset = (pr: AnalyticsPeriod) => ui.setAnalyticsPeriod(pr);

  return (
    <TabScreen title="Analytics" subtitle="Personal money" refreshing={current.isRefetching} onRefresh={refresh}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
        {PRESETS.map((pr) => (
          <Chip key={pr} label={PERIOD_LABELS[pr]} selected={ui.analyticsPeriod === pr} onPress={() => choosePreset(pr)} />
        ))}
        <Chip label="Custom" icon="date_range" selected={ui.analyticsPeriod === 'custom'} onPress={() => choosePreset('custom')} />
      </ScrollView>
      {ui.analyticsPeriod === 'custom' && (
        <Row style={{ flexWrap: 'wrap', marginBottom: space.md }}>
          <DateButton
            label="From"
            value={ui.analyticsCustom.from}
            maximumDate={ui.analyticsCustom.to}
            onChange={(from) => ui.setAnalyticsCustom({ ...ui.analyticsCustom, from })}
          />
          <DateButton
            label="To"
            value={ui.analyticsCustom.to}
            minimumDate={ui.analyticsCustom.from}
            onChange={(to) => ui.setAnalyticsCustom({ ...ui.analyticsCustom, to })}
          />
        </Row>
      )}
      <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
        {formatDateLabel(range.from)} – {formatDateLabel(range.to)} · compared with {prev.label} ({formatDateLabel(prev.range.from)} – {formatDateLabel(prev.range.to)})
      </Text>

      {!s || !p ? (
        <Loading />
      ) : (
        <>
          <View style={styles.grid}>
            <Card style={styles.cell}>
              <Text variant="caption" tone="muted">Income</Text>
              <Amount minor={s.incomeMinor} variant="heading" color={c.positive} />
              <Change now={s.incomeMinor} before={p.incomeMinor} />
            </Card>
            <Card style={styles.cell}>
              <Text variant="caption" tone="muted">Spending</Text>
              <Amount minor={s.expenseMinor} variant="heading" color={c.negative} />
              <Change now={s.expenseMinor} before={p.expenseMinor} invert />
            </Card>
            <Card style={styles.cell}>
              <Text variant="caption" tone="muted">Net cash flow</Text>
              <Amount minor={s.netMinor} variant="heading" sign="always" colored="negative-only" />
              <Text variant="caption" tone="faint">
                Savings rate {s.savingsRate === null ? '—' : `${Math.round(s.savingsRate * 100)}%`}
              </Text>
            </Card>
            <Card style={styles.cell}>
              <Text variant="caption" tone="muted">Avg. daily spending</Text>
              <Amount minor={Math.round(s.expenseMinor / Math.max(1, calendarDays))} variant="heading" />
              <Text variant="caption" tone="faint">
                over {calendarDays} calendar days
              </Text>
            </Card>
          </View>

          <Card style={{ marginTop: space.sm, gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="label" tone="muted">Per active spending day</Text>
              <Text variant="label">
                {s.activeSpendingDays ? formatMoney(Math.round(s.expenseMinor / s.activeSpendingDays)) : '—'}
              </Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="label" tone="muted">Per week (calendar)</Text>
              <Text variant="label">{formatMoney(Math.round((s.expenseMinor * 7) / Math.max(1, calendarDays)))}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="label" tone="muted">Per month (calendar)</Text>
              <Text variant="label">{formatMoney(Math.round((s.expenseMinor * 30.44) / Math.max(1, calendarDays)))}</Text>
            </Row>
            <Text variant="caption" tone="faint">
              {s.activeSpendingDays} of {calendarDays} days had spending. {s.expenseCount} expenses recorded. Weekly and monthly figures scale the
              daily calendar average (× 7 and × 30.44).
            </Text>
          </Card>

          {s.companyIncomeMinor > 0 && (
            <View style={{ marginTop: space.sm }}>
              <Banner tone="info">{`Income includes ${formatMoney(s.companyIncomeMinor)} classified as salary or dividends from your company.`}</Banner>
            </View>
          )}
          {s.adjustmentsMinor !== 0 && (
            <View style={{ marginTop: space.sm }}>
              <Banner tone="warning" title="Balance adjustments (not counted above)">
                {`${formatMoney(s.adjustmentsMinor, 'MAD', { sign: 'always' })} recorded from balance checks. These are unexplained differences, not income or spending.`}
              </Banner>
            </View>
          )}
          {s.unconvertedCurrencies.length > 0 && (
            <View style={{ marginTop: space.sm }}>
              <Banner tone="warning">{`Activity in ${s.unconvertedCurrencies.join(', ')} is excluded — add an exchange rate in Settings.`}</Banner>
            </View>
          )}

          {(insights.data ?? []).length > 0 && (
            <>
              <SectionHeader title="Insights · this month" />
              <InsightList insights={insights.data!} />
            </>
          )}

          <SectionHeader title="Budgets" action={{ label: (budgets.data ?? []).length ? 'Manage' : 'Set up', onPress: () => router.push('/budgets') }} />
          {(budgets.data ?? []).length === 0 ? (
            <Card onPress={() => router.push('/budgets/edit')}>
              <Text tone="muted">No budget yet. Set a monthly, weekly or custom spending limit, with optional category limits.</Text>
            </Card>
          ) : (
            <View style={{ gap: space.sm }}>
              {budgets.data!.map((b) => (
                <BudgetCard key={b.budget.id} status={b} />
              ))}
            </View>
          )}

          <SectionHeader title="Spending breakdown" />
          {filter && (
            <Card tone="primary" style={{ marginBottom: space.sm }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label" color={c.primary} style={{ flex: 1 }}>
                  Only: {filter.label} · {formatMoney(scoped.reduce((x, f) => x + f.scopedMinor, 0))}
                </Text>
                <Button compact kind="ghost" label="Clear" onPress={() => ui.setAnalyticsFilter(null)} />
              </Row>
            </Card>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
            {DIMENSIONS.filter((d) => d.value !== filter?.kind).map((d) => (
              <Chip
                key={d.value}
                label={d.label}
                selected={ui.analyticsDimension === d.value}
                onPress={() => ui.setAnalyticsDimension(d.value)}
                color={c.textMuted}
              />
            ))}
          </ScrollView>
          {!split ? (
            <Loading />
          ) : split.rows.length === 0 ? (
            <Card>
              <EmptyState icon="donut_large" title="No spending in this period" />
            </Card>
          ) : (
            <Card style={{ gap: space.lg }}>
              {split.overlapping && (
                <Text variant="caption" tone="muted">
                  A transaction with several tags appears under each of them, so rows add up to more than the total. The total{' '}
                  {formatMoney(split.totalMinor)} counts each transaction once.
                </Text>
              )}
              {ui.analyticsDimension === 'product' && (
                <Text variant="caption" tone="muted">
                  Product amounts come from itemised lines. The rest of each receipt is shown as “not itemised”.
                </Text>
              )}
              {split.rows.map((row) => {
                const drill = drillFilter(range, filter, row.drill);
                return (
                  <BreakdownItem
                    key={row.key}
                    row={row}
                    max={split.rows[0].totalMinor}
                    total={split.totalMinor}
                    before={prevSplit?.rows.find((x) => x.key === row.key)?.totalMinor ?? (prevSplit ? 0 : undefined)}
                    canFilter={!filter && row.filter !== null}
                    onFilter={() => {
                      ui.setAnalyticsFilter(row.filter);
                      ui.setAnalyticsDimension(row.filter?.kind === 'category' ? 'subcategory' : 'category');
                    }}
                    onOpen={drill ? () => openTransactions(drill, filter ? `${filter.label} · ${row.label}` : row.label) : null}
                  />
                );
              })}
            </Card>
          )}

          {essential && essential.rows.length > 0 && ui.analyticsDimension !== 'essential' && (
            <>
              <SectionHeader title="Essential vs discretionary" />
              <Card style={{ gap: space.md }}>
                <StackedBar
                  slices={essential.rows.map((r) => ({ key: r.key, label: r.label, minor: r.totalMinor, color: r.color ?? c.textMuted }))}
                />
                <Row style={{ flexWrap: 'wrap' }}>
                  {essential.rows.map((r) => (
                    <Chip
                      key={r.key}
                      label={`Show ${r.label.toLowerCase()}`}
                      onPress={() => openTransactions(drillFilter(range, filter, r.drill)!, r.label)}
                    />
                  ))}
                </Row>
                <Text variant="caption" tone="faint">
                  Based on each category’s setting; subcategories inherit their parent’s. Change it in Categories.
                </Text>
              </Card>
            </>
          )}

          <SectionHeader title="Personal money over time" action={{ label: 'Per location', onPress: () => router.push('/trends') }} />
          <Card style={{ gap: space.md }}>
            <Segmented
              options={TREND.map((t) => ({ value: t.value, label: t.label }))}
              value={trend.value}
              onChange={(g) => {
                ui.setTrendGranularity(g);
                setTrendIndex(null);
              }}
            />
            {points.length === 0 ? (
              <Loading />
            ) : (
              <LineChart
                points={points}
                selected={selectedTrend}
                onSelect={setTrendIndex}
                footer={
                  <Text
                    variant="caption"
                    color={c.primary}
                    onPress={() => {
                      const r = bucketRange(trend.value, trendDays[selectedTrend]);
                      openTransactions({ from: r.from, to: r.to, ownership: 'personal' }, `Activity · ${points[selectedTrend].label}`);
                    }}>
                    Balance at end of {formatDateLabel(trendDays[selectedTrend])} · show activity →
                  </Text>
                }
              />
            )}
          </Card>

          <SectionHeader title="Explore" />
          <Card padded={false}>
            <ListItem icon="shopping_basket" iconColor={c.primary} title="Products & prices" subtitle="Price history, cheapest shop" chevron onPress={() => router.push('/products')} />
            <Divider inset={68} />
            <ListItem icon="store" iconColor={c.primary} title="Merchants" subtitle="Spend, visits, average ticket" chevron onPress={() => router.push('/merchants')} />
            <Divider inset={68} />
            <ListItem icon="category" iconColor={c.primary} title="Categories" subtitle="Subcategories, essential, merge" chevron onPress={() => router.push('/categories')} />
            <Divider inset={68} />
            <ListItem icon="sell" iconColor={c.primary} title="Tags" subtitle="Rename, merge, archive" chevron onPress={() => router.push('/tags')} />
          </Card>
        </>
      )}
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { flexBasis: '48%', flexGrow: 1, gap: 2, padding: space.md },
});
