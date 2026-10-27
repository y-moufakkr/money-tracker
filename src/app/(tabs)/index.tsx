import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { BarRow } from '@/components/breakdown';
import { TransactionRow } from '@/components/transaction-row';
import { formatMonthLabel, presetRange, todayISO } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useMoneySummary, usePeriodSummary, useTransactions } from '@/hooks/data';
import { Icon } from '@/ui/icon';
import { TabScreen } from '@/ui/layout';
import { Amount, Button, Card, Divider, EmptyState, IconButton, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

function Stat({ label, minor, tint, sign }: { label: string; minor: number; tint?: string; sign?: 'always' }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Amount minor={minor} variant="heading" color={tint} sign={sign} />
    </View>
  );
}

export default function HomeScreen() {
  const c = useColors();
  const today = todayISO();
  const month = presetRange('this_month', today);
  const summary = useMoneySummary();
  const period = usePeriodSummary(month);
  const recent = useTransactions({ limit: 6 });

  const refreshing = summary.isRefetching || period.isRefetching;
  const refresh = () => {
    summary.refetch();
    period.refetch();
    recent.refetch();
  };

  if (summary.isLoading || period.isLoading) {
    return (
      <TabScreen title="Home">
        <Loading />
      </TabScreen>
    );
  }

  const p = summary.data!.personal;
  const s = period.data!;
  const companyTotal = summary.data!.companies.reduce((sum, co) => sum + co.total, 0);
  const noAccounts = p.accounts.length === 0 && summary.data!.companies.length === 0;
  const topCats = s.byCategory.slice(0, 5);

  return (
    <TabScreen
      title="Home"
      subtitle={formatMonthLabel(today)}
      refreshing={refreshing}
      onRefresh={refresh}
      headerRight={<IconButton icon="settings" label="Settings" onPress={() => router.push('/settings')} />}>
      {noAccounts ? (
        <Card>
          <EmptyState
            icon="savings"
            title="Welcome"
            message="Start by adding the places where you keep money — bank accounts, wallet, cash at home, savings and your company account."
            action={{ label: 'Add first location', onPress: () => router.push('/accounts/new') }}
          />
        </Card>
      ) : (
        <>
          <Card tone="primary" onPress={() => router.push('/money')} style={{ gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="label" color={c.primary}>
                My money now
              </Text>
              <Row gap={2}>
                <Text variant="label" color={c.primary}>
                  Details
                </Text>
                <Icon name="chevron_right" size={18} color={c.primary} />
              </Row>
            </Row>
            <Amount minor={p.liquid} variant="display" />
            <Text variant="caption" tone="muted">
              Available {formatMoney(p.available)}
              {p.liabilities > 0 ? ` · Owed ${formatMoney(p.liabilities)}` : ''}
              {p.unconverted.length > 0 ? ` · ${p.unconverted.length} foreign location(s) not counted` : ''}
            </Text>
          </Card>

          {summary.data!.companies.length > 0 && (
            <Pressable onPress={() => router.push('/money')} style={[styles.company, { backgroundColor: c.businessSoft }]}>
              <Icon name="domain" size={18} color={c.business} />
              <Text variant="label" color={c.business} style={{ flex: 1 }}>
                Company cash & bank (separate)
              </Text>
              <Amount minor={companyTotal} variant="label" color={c.business} />
            </Pressable>
          )}

          <SectionHeader title="This month" action={{ label: 'Analytics', onPress: () => router.push('/analytics') }} />
          <View style={styles.stats}>
            <Stat label="Income" minor={s.incomeMinor} tint={c.positive} />
            <Stat label="Spending" minor={s.expenseMinor} tint={c.negative} />
            <Stat label="Saved (income − spending)" minor={s.netMinor} sign="always" tint={s.netMinor < 0 ? c.negative : undefined} />
            <View style={[styles.stat, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text variant="caption" tone="muted">
                Savings rate
              </Text>
              <Text variant="heading">{s.savingsRate === null ? '—' : `${Math.round(s.savingsRate * 100)}%`}</Text>
            </View>
          </View>
          {s.companyIncomeMinor > 0 && (
            <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
              Income includes {formatMoney(s.companyIncomeMinor)} salary/dividends paid by your company.
            </Text>
          )}

          {topCats.length > 0 && (
            <>
              <SectionHeader title="Top spending" />
              <Card style={{ gap: space.md }}>
                {topCats.map((cat) => (
                  <Pressable key={cat.categoryId ?? 'none'} onPress={() => router.push('/analytics')}>
                    <BarRow label={cat.name} minor={cat.totalMinor} max={topCats[0].totalMinor} color={cat.color ?? c.primary} />
                  </Pressable>
                ))}
              </Card>
            </>
          )}

          <SectionHeader title="Recent" action={{ label: 'All', onPress: () => router.push('/transactions') }} />
          <Card padded={false}>
            {(recent.data ?? []).length === 0 ? (
              <View style={{ padding: space.lg, gap: space.md }}>
                <Text tone="muted">Nothing recorded yet. Tap + to add your first expense.</Text>
                <Button label="Add expense" icon="add" onPress={() => router.push('/entry/expense')} />
              </View>
            ) : (
              recent.data!.map((t, i) => (
                <View key={t.id}>
                  {i > 0 && <Divider inset={68} />}
                  <TransactionRow t={t} />
                </View>
              ))
            )}
          </Card>
        </>
      )}
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { flexBasis: '48%', flexGrow: 1, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  company: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    marginTop: space.sm,
  },
});
