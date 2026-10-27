import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { formatMoney } from '@/domain/money';
import { openTransactions } from '@/lib/drill';
import { PAYOUT_LABEL } from '@/services/distributions';
import type { ThreeTotals } from '@/services/overview';
import { Icon } from '@/ui/icon';
import { Amount, Banner, Card, Divider, Row, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

function Heading({ letter, title, color }: { letter: string; title: string; color: string }) {
  return (
    <Row gap={space.sm}>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption" color={color} style={{ fontWeight: '700' }}>
          {letter}
        </Text>
      </View>
      <Text variant="label" color={color} style={{ flex: 1 }}>
        {title}
      </Text>
    </Row>
  );
}

function Line({ label, minor, strong, tint }: { label: string; minor: number; strong?: boolean; tint?: string }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text variant={strong ? 'bodyStrong' : 'caption'} tone={strong ? undefined : 'muted'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Amount minor={minor} variant={strong ? 'bodyStrong' : 'label'} color={tint} />
    </Row>
  );
}

/**
 * A (personal money), B (company position) and C (potential payout), shown
 * side by side and never added together. Scenarios show how a payment would
 * move money from B to A without creating any.
 */
export function ThreeTotalsCard({ t, compact, aDetail }: { t: ThreeTotals; compact?: boolean; aDetail?: string }) {
  const c = useColors();
  const [showScenarios, setShowScenarios] = useState(false);
  const div = t.personalDividendIncome;
  const missing = t.c.companies.flatMap((x) => x.payout.missing.slice(0, 1).map((m) => `${x.company.name}: ${m}`));

  return (
    <View style={{ gap: space.sm }}>
      <Card tone="primary" style={{ gap: 4 }} onPress={compact ? () => router.push('/money') : undefined}>
        <Heading letter="A" title="My actual personal money" color={c.primary} />
        <Amount minor={t.a.liquidMinor} variant="title" />
        <Text variant="caption" tone="muted">
          {aDetail ? `${aDetail} · ` : ''}Personal accounts only{t.a.netLiquidMinor !== t.a.liquidMinor ? ` · ${formatMoney(t.a.netLiquidMinor)} after debts` : ''}
          {t.a.unconvertedCount ? ` · ${t.a.unconvertedCount} foreign location(s) not counted` : ''}
        </Text>
      </Card>

      {t.b.map((b) => (
        <Card key={b.company.id} tone="business" style={{ gap: 4 }} onPress={() => router.push(`/company/${b.company.id}`)}>
          <Row>
            <View style={{ flex: 1 }}>
              <Heading letter="B" title={`${b.company.name} · company position`} color={c.business} />
            </View>
            <Icon name="chevron_right" size={18} color={c.business} />
          </Row>
          <Amount minor={b.position.liquidityMinor} variant="title" color={b.position.liquidityMinor < 0 ? c.negative : c.business} />
          <Text variant="caption" tone="muted">
            Estimated liquidity after obligations. Belongs to the company.
          </Text>
          {!compact && (
            <View style={{ gap: 2, marginTop: space.xs }}>
              <Line label="Cash & bank" minor={b.position.cashMinor} />
              <Line label="− Outstanding obligations" minor={-b.position.obligationsMinor} />
              {b.position.reservedMinor > 0 && <Line label="− Set aside" minor={-b.position.reservedMinor} />}
            </View>
          )}
        </Card>
      ))}

      {t.b.length > 0 && (
        <Card tone="estimate" style={{ gap: 4 }}>
          <Heading letter="C" title="Potential future personal payout" color={c.estimate} />
          <Text variant="caption" color={c.estimate}>
            {PAYOUT_LABEL}
          </Text>
          <View style={{ gap: 2, marginTop: space.xs }}>
            <Line label="Approved, not yet paid to you (net)" minor={t.c.approvedUnpaidMinor} tint={c.estimate} />
            {t.c.estimatedNetMinor !== null ? (
              <Line
                label={
                  t.c.companies.every((x) => x.payout.simple)
                    ? 'Your share of company money (simple estimate)'
                    : t.c.companies.some((x) => x.payout.simple)
                      ? 'Estimated (profit, or your simple share)'
                      : 'Estimated from undistributed profit (net)'
                }
                minor={t.c.estimatedNetMinor}
                tint={c.estimate}
              />
            ) : (
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                  Estimated from undistributed profit
                </Text>
                <Text variant="label" tone="faint">
                  not available
                </Text>
              </Row>
            )}
          </View>
          {t.c.companies.map((x) =>
            x.payout.estimatedNetMinor !== null && !compact ? (
              <Text key={x.company.id} variant="caption" tone="muted">
                {x.company.name}: {x.payout.calculation.join(' ')}
              </Text>
            ) : null,
          )}
          {missing.length > 0 && (
            <Text variant="caption" tone="faint" numberOfLines={compact ? 2 : undefined}>
              {missing.join(' ')}
            </Text>
          )}
        </Card>
      )}

      {t.b.length > 0 && (
        <Row gap={space.xs} style={{ paddingHorizontal: space.xs }}>
          <Icon name="block" size={14} color={c.textMuted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            A, B and C measure different things and are never added together.
          </Text>
        </Row>
      )}

      {div && (
        <Pressable onPress={() => openTransactions(div.drill, 'Personal income recorded as dividends')}>
          <Banner tone="warning" title="Dividends recorded as personal income">
            {`${div.count} personal income entr${div.count > 1 ? 'ies' : 'y'} (${formatMoney(div.totalMinor)}, last 12 months) use a dividend category. If that money came from your company, record it as a company → personal dividend transfer instead, or it may be counted twice. Tap to review.`}
          </Banner>
        </Pressable>
      )}

      {t.scenarios.length > 0 && (
        <Card padded={false}>
          <Pressable onPress={() => setShowScenarios((v) => !v)} accessibilityRole="button" style={{ padding: space.md }}>
            <Row>
              <Icon name="alt_route" size={18} color={c.estimate} />
              <Text variant="label" style={{ flex: 1 }}>
                What if… ({t.scenarios.length} scenario{t.scenarios.length > 1 ? 's' : ''})
              </Text>
              <Icon name={showScenarios ? 'expand_less' : 'expand_more'} size={18} color={c.textMuted} />
            </Row>
          </Pressable>
          {showScenarios &&
            t.scenarios.map((s) => (
              <View key={s.id}>
                <Divider />
                <View style={{ padding: space.md, gap: 4 }}>
                  <Text variant="bodyStrong">{s.title}</Text>
                  {s.lines.map((l) => (
                    <Row key={l.label} style={{ justifyContent: 'space-between' }}>
                      <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                        {l.label}
                      </Text>
                      <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
                        {formatMoney(l.beforeMinor)} → {formatMoney(l.afterMinor)}
                      </Text>
                    </Row>
                  ))}
                  <Text variant="caption" tone="faint">
                    Scenario only. {s.note}
                  </Text>
                </View>
              </View>
            ))}
        </Card>
      )}
    </View>
  );
}
