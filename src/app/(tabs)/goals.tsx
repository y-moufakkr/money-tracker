import { router } from 'expo-router';
import { View } from 'react-native';

import { Meter } from '@/components/charts';
import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useGoals, useMoneySummary } from '@/hooks/data';
import { TabScreen } from '@/ui/layout';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconBadge, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function GoalsScreen() {
  const c = useColors();
  const summary = useMoneySummary();
  const goals = useGoals();
  const p = summary.data?.personal;

  return (
    <TabScreen
      title="Goals"
      subtitle="Savings"
      refreshing={goals.isRefetching}
      onRefresh={() => (goals.refetch(), summary.refetch())}>
      {!p || !goals.data ? (
        <Loading />
      ) : (
        <>
          <Card tone="primary" style={{ gap: space.xs }}>
            <Text variant="label" color={c.primary}>
              Reserved for goals
            </Text>
            <Amount minor={p.reservedGoals} variant="display" />
            <Divider />
            <Row style={{ justifyContent: 'space-between', marginTop: space.sm }}>
              <View>
                <Text variant="caption" tone="muted">
                  Personal money
                </Text>
                <Amount minor={p.liquid} variant="bodyStrong" />
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="caption" tone="muted">
                  {p.reservedBills > 0 ? 'Unallocated (after bills)' : 'Unallocated'}
                </Text>
                <Amount minor={p.available} variant="bodyStrong" colored="negative-only" />
              </View>
            </Row>
            <Text variant="caption" tone="muted" style={{ marginTop: space.xs }}>
              Goals reserve part of your real accounts. No money moves, and reserved money is not added to your total.
            </Text>
          </Card>

          {p.overAllocated.length > 0 && (
            <View style={{ marginTop: space.md }}>
              <Banner tone="warning" title="More reserved than some accounts hold">
                {p.overAllocated
                  .map((o) => `${o.account.name}: ${formatMoney(o.shortMinor, o.account.currency)} of its reservations is not covered`)
                  .join('\n')}
              </Banner>
            </View>
          )}

          <SectionHeader title={`Goals (${goals.data.length})`} action={{ label: 'New goal', onPress: () => router.push('/goals/edit') }} />
          {goals.data.length === 0 ? (
            <Card>
              <EmptyState
                icon="flag"
                title="No goals yet"
                message="Create an emergency fund, maternity fund, holiday… then reserve part of a real account for each one."
                action={{ label: 'Create a goal', onPress: () => router.push('/goals/edit') }}
              />
            </Card>
          ) : (
            <View style={{ gap: space.sm }}>
              {goals.data.map((g) => (
                <Card key={g.id} onPress={() => router.push(`/goals/${g.id}`)} style={{ gap: space.sm }}>
                  <Row gap={space.md}>
                    <IconBadge icon={g.icon ?? 'flag'} color={g.color ?? c.primary} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {g.name}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {formatMoney(g.savedMinor)} of {formatMoney(g.targetMinor)}
                        {g.targetDate ? ` · by ${formatDateLabel(g.targetDate)}` : ''}
                      </Text>
                    </View>
                    <Text variant="heading">{Math.floor(g.progress * 100)}%</Text>
                  </Row>
                  <Meter ratio={g.progress} />
                  {g.remainingMinor > 0 && g.plan.neededPerMonthMinor !== null && (
                    <Text variant="caption" color={g.plan.onTrack === false ? c.warning : c.textMuted}>
                      Needs {formatMoney(g.plan.neededPerMonthMinor)}/month
                      {g.monthlyPlanMinor ? ` · plan ${formatMoney(g.monthlyPlanMinor)}/month${g.plan.onTrack === false ? ' (not enough)' : ''}` : ''}
                    </Text>
                  )}
                  {g.unbackedMinor > 0 && (
                    <Text variant="caption" color={c.warning}>
                      {formatMoney(g.unbackedMinor)} reserved is not covered by the account balance.
                    </Text>
                  )}
                  {g.allocations.length === 0 && (
                    <Text variant="caption" tone="muted">
                      Nothing reserved yet — open to allocate from an account.
                    </Text>
                  )}
                </Card>
              ))}
            </View>
          )}

          {goals.data.length > 0 && (
            <Button kind="secondary" icon="add" label="New goal" onPress={() => router.push('/goals/edit')} style={{ marginTop: space.lg }} />
          )}
        </>
      )}
    </TabScreen>
  );
}
