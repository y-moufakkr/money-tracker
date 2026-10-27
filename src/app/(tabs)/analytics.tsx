import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BarRow } from '@/components/breakdown';
import {
  addDays,
  addMonths,
  daysBetweenInclusive,
  daysInMonth,
  formatDateLabel,
  PERIOD_LABELS,
  presetRange,
  todayISO,
  type DateRange,
  type PeriodPreset,
} from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { usePeriodSummary } from '@/hooks/data';
import { useUiStore } from '@/hooks/ui-store';
import { TabScreen } from '@/ui/layout';
import { Amount, Banner, Card, Chip, EmptyState, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const PRESETS: PeriodPreset[] = ['this_week', 'last_week', 'this_month', 'last_month', 'last_30', 'last_90', 'this_year', 'last_year'];

/**
 * The comparison period. "To date" periods are compared with the same number
 * of days at the start of the previous period, so partial months stay fair.
 */
function previousRange(preset: PeriodPreset, range: DateRange): { range: DateRange; label: string } {
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

export default function AnalyticsScreen() {
  const c = useColors();
  const preset = useUiStore((s) => s.analyticsPeriod);
  const setPreset = useUiStore((s) => s.setAnalyticsPeriod);
  const range = presetRange(preset);
  const prev = previousRange(preset, range);
  const current = usePeriodSummary(range);
  const before = usePeriodSummary(prev.range);

  const s = current.data;
  const p = before.data;
  const today = todayISO();
  const calendarDays = daysBetweenInclusive(range.from, range.to < today ? range.to : today);

  return (
    <TabScreen title="Analytics" subtitle="Personal money" refreshing={current.isRefetching} onRefresh={() => (current.refetch(), before.refetch())}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
        {PRESETS.map((pr) => (
          <Chip key={pr} label={PERIOD_LABELS[pr]} selected={preset === pr} onPress={() => setPreset(pr)} />
        ))}
      </ScrollView>
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

          <Card style={{ marginTop: space.sm, gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="label" tone="muted">Per active spending day</Text>
              <Text variant="label">
                {s.activeSpendingDays ? formatMoney(Math.round(s.expenseMinor / s.activeSpendingDays)) : '—'}
              </Text>
            </Row>
            <Text variant="caption" tone="faint">
              {s.activeSpendingDays} of {calendarDays} days had spending. {s.expenseCount} expenses recorded.
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

          <SectionHeader title="Spending by category" />
          {s.byCategory.length === 0 ? (
            <Card>
              <EmptyState icon="donut_large" title="No spending in this period" />
            </Card>
          ) : (
            <Card style={{ gap: space.lg }}>
              {s.byCategory.map((cat) => {
                const prevCat = p.byCategory.find((x) => x.categoryId === cat.categoryId)?.totalMinor ?? 0;
                const share = s.expenseMinor ? Math.round((cat.totalMinor / s.expenseMinor) * 100) : 0;
                return (
                  <Pressable
                    key={cat.categoryId ?? 'none'}
                    accessibilityRole="button"
                    accessibilityHint="Shows the transactions in this category"
                    onPress={() =>
                      router.push({
                        pathname: '/transactions',
                        params: { categoryId: cat.categoryId ?? '', categoryName: cat.name, from: range.from, to: range.to },
                      })
                    }
                    style={{ gap: 2 }}>
                    <BarRow
                      label={cat.name}
                      minor={cat.totalMinor}
                      max={s.byCategory[0].totalMinor}
                      color={cat.color ?? c.primary}
                      detail={`${share}% · ${cat.count}×`}
                    />
                    <Row style={{ justifyContent: 'flex-end' }}>
                      <Change now={cat.totalMinor} before={prevCat} invert />
                    </Row>
                  </Pressable>
                );
              })}
            </Card>
          )}

          <Card tone="estimate" style={{ marginTop: space.xl, gap: 4, borderRadius: radius.lg }}>
            <Text variant="bodyStrong" color={c.estimate}>
              Coming in Phase 2
            </Text>
            <Text variant="caption" tone="muted">
              Merchants, products and price history, tags, budgets, balance trends and rule-based insights.
            </Text>
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
