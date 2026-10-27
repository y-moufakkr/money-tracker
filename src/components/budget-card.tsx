import { router } from 'expo-router';
import { View } from 'react-native';

import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { openTransactions } from '@/lib/drill';
import type { BudgetMeter, BudgetStatus } from '@/services/budgets';
import { Card, Row, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';
import { Meter } from './charts';

const pct = (r: number) => (Number.isFinite(r) ? `${Math.round(r * 100)}%` : '—');

export function MeterRow({
  label,
  m,
  thresholds,
  onPress,
}: {
  label: string;
  m: BudgetMeter;
  thresholds: number[];
  onPress?: () => void;
}) {
  const c = useColors();
  const over = m.remainingMinor < 0;
  return (
    <View style={{ gap: 6 }}>
      <Row>
        <Text variant="label" style={{ flex: 1 }} numberOfLines={1} onPress={onPress}>
          {label}
        </Text>
        <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>
          {formatMoney(m.spentMinor)} / {formatMoney(m.budgetMinor)}
        </Text>
      </Row>
      <Meter ratio={m.usedRatio} thresholds={thresholds} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="caption" color={over ? c.negative : m.thresholdReached !== null ? c.warning : c.textMuted}>
          {pct(m.usedRatio)} used{m.thresholdReached !== null && !over ? ` · past ${m.thresholdReached}% warning` : ''}
        </Text>
        <Text variant="caption" color={over ? c.negative : c.textMuted}>
          {over ? `${formatMoney(-m.remainingMinor)} over` : `${formatMoney(m.remainingMinor)} left`}
        </Text>
      </Row>
    </View>
  );
}

/** Budget vs actual for one budget: total, then each line, then everything else. */
export function BudgetCard({ status, detailed }: { status: BudgetStatus; detailed?: boolean }) {
  const c = useColors();
  const s = status;
  const t = s.budget.thresholds;
  const drillBase = { from: s.range.from, to: s.range.to, kinds: ['expense' as const], ownership: 'personal' as const };
  return (
    <Card style={{ gap: space.md }} onPress={detailed ? undefined : () => router.push('/budgets')}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="bodyStrong">{s.budget.name}</Text>
        <Text variant="caption" tone="muted">
          {formatDateLabel(s.range.from)} – {formatDateLabel(s.range.to)}
        </Text>
      </Row>
      <MeterRow label="Total" m={s.total} thresholds={t} />
      <Text variant="caption" tone="muted">
        {s.daysLeft > 0 ? `${s.daysLeft} day${s.daysLeft > 1 ? 's' : ''} left` : s.daysElapsed === 0 ? 'Not started yet' : 'Period ended'}
        {s.daysElapsed > 0 && s.daysElapsed < s.daysTotal
          ? ` · projected ${formatMoney(s.total.projectedMinor)} (${formatMoney(s.total.spentMinor)} ÷ ${s.daysElapsed} days × ${s.daysTotal})`
          : ''}
      </Text>
      {s.projectedOver && s.total.remainingMinor >= 0 && (
        <Text variant="caption" color={c.warning}>
          At this pace you will go over by {formatMoney(s.total.projectedMinor - s.total.budgetMinor)}.
        </Text>
      )}
      {detailed &&
        s.lines.map((l) => (
          <MeterRow
            key={l.categoryId}
            label={l.name}
            m={l}
            thresholds={t}
            onPress={() => openTransactions({ ...drillBase, categoryId: l.categoryId, includeSubcategories: true }, `${l.name} · ${s.budget.name}`)}
          />
        ))}
      {detailed && s.other && (
        <MeterRow label="Everything else" m={s.other} thresholds={t} />
      )}
      {!detailed && s.lines.length > 0 && (
        <Text variant="caption" tone="muted">
          {s.lines.filter((l) => l.usedRatio >= 1).length > 0
            ? `${s.lines.filter((l) => l.usedRatio >= 1).map((l) => l.name).join(', ')} over limit`
            : `${s.lines.length} category limit${s.lines.length > 1 ? 's' : ''}, none exceeded`}
        </Text>
      )}
    </Card>
  );
}
