import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, View } from 'react-native';

import { LineChart } from '@/components/charts';
import { RenameMerge } from '@/components/rename-merge';
import { formatDateLabel } from '@/domain/dates';
import { formatMoney, formatQuantity } from '@/domain/money';
import { formatNormalisedQuantity } from '@/domain/units';
import { useLedgerMutation, useProduct, useProducts } from '@/hooks/data';
import { openTransactions } from '@/lib/drill';
import type { UnitGroupStats } from '@/services/analytics';
import { mergeProduct, renameProduct } from '@/services/catalog';
import { Banner, Button, Card, Divider, EmptyState, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <View style={{ flexBasis: '48%', flexGrow: 1, gap: 2 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      {hint ? (
        <Text variant="caption" tone="faint" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function GroupCard({ g }: { g: UnitGroupStats }) {
  const per = (v: number) => `${formatMoney(v)}/${g.unitLabel}`;
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md, columnGap: space.sm }}>
        <Stat label="Quantity bought" value={g.quantityMicro ? `${formatNormalisedQuantity(g.quantityMicro)} ${g.unitLabel}` : '—'} hint={`${g.lineCount} line${g.lineCount > 1 ? 's' : ''}`} />
        <Stat
          label="Average price"
          value={g.averagePriceMinor === null ? '—' : per(g.averagePriceMinor)}
          hint={g.averagePriceMinor === null ? null : `${formatMoney(g.measuredSpentMinor)} ÷ ${formatNormalisedQuantity(g.quantityMicro)} ${g.unitLabel}`}
        />
        <Stat label="Latest" value={g.latest ? per(g.latest.priceMinor) : '—'} hint={g.latest ? `${formatDateLabel(g.latest.date)}${g.latest.merchantName ? ` · ${g.latest.merchantName}` : ''}` : null} />
        <Stat
          label="Cheapest"
          value={g.cheapest ? per(g.cheapest.priceMinor) : '—'}
          hint={g.cheapest ? `${formatDateLabel(g.cheapest.date)}${g.cheapest.merchantName ? ` · ${g.cheapest.merchantName}` : ''}` : null}
        />
      </View>
      {g.series.length >= 2 && (
        <>
          <Divider />
          <Text variant="label" tone="muted">
            Price per {g.unitLabel} over time
          </Text>
          <LineChart
            points={g.series.map((p) => ({ label: `${formatDateLabel(p.date)}${p.merchantName ? ` · ${p.merchantName}` : ''}`, value: p.priceMinor }))}
            format={(v) => per(v)}
            height={120}
            zeroBased={false}
          />
        </>
      )}
      {g.byMerchant.length > 0 && (
        <>
          <Divider />
          <Text variant="label" tone="muted">
            By merchant (cheapest average first)
          </Text>
          {g.byMerchant.map((m) => (
            <Row key={m.merchantId ?? 'none'} style={{ justifyContent: 'space-between' }}>
              <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                {m.merchantName}
              </Text>
              <Text variant="caption" tone="muted">
                {m.count}× · low {per(m.lowestPriceMinor)}
              </Text>
              <Text variant="label" style={{ width: 110, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                {per(m.averagePriceMinor)}
              </Text>
            </Row>
          ))}
        </>
      )}
    </Card>
  );
}

export default function ProductScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: p, isLoading } = useProduct(id);
  const all = useProducts('').data ?? [];
  const rename = useLedgerMutation((db, name: string) => renameProduct(db, id, name));
  const merge = useLedgerMutation((db, target: string) => mergeProduct(db, id, target));

  if (isLoading) return <Loading />;
  if (!p) return <EmptyState icon="error" title="Product not found" message="It may have been merged into another product." />;
  const s = p.stats;

  return (
    <>
      <Stack.Screen options={{ title: p.name }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <Card tone="primary" style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md, columnGap: space.sm }}>
            <Stat label="Total spent" value={formatMoney(s.totalSpentMinor)} hint="Sum of recorded item amounts" />
            <Stat label="Purchases" value={String(s.purchaseCount)} hint={s.firstDate ? `since ${formatDateLabel(s.firstDate)}` : null} />
            <Stat label="Last bought" value={s.lastDate ? formatDateLabel(s.lastDate) : '—'} />
            <Stat label="Bought every" value={s.averageDaysBetween === null ? '—' : `~${s.averageDaysBetween} days`} hint="Average gap between purchase days" />
          </View>
        </Card>
        <Button
          kind="ghost"
          icon="receipt_long"
          label="Show these purchases"
          onPress={() => openTransactions({ productId: p.id, kinds: ['expense'] }, p.name)}
        />

        {s.groups.length > 1 && (
          <Banner tone="info" title="Recorded in different kinds of units">
            {`Units that cannot be converted into each other (${s.groups.map((g) => g.unitLabel).join(', ')}) are shown separately. Nothing is converted by guessing.`}
          </Banner>
        )}
        {s.groups.map((g) => (
          <View key={g.group}>
            <SectionHeader title={`Per ${g.unitLabel}`} />
            <GroupCard g={g} />
          </View>
        ))}
        {s.linesWithoutUnit > 0 && (
          <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
            {s.linesWithoutUnit} purchase line{s.linesWithoutUnit > 1 ? 's have' : ' has'} no unit, so no price per unit is shown for {s.linesWithoutUnit > 1 ? 'them' : 'it'}.
          </Text>
        )}

        <SectionHeader title="Purchase history" />
        <Card padded={false}>
          {[...s.lines].reverse().map((l, i) => (
            <View key={l.itemId}>
              {i > 0 && <Divider inset={space.lg} />}
              <Row style={{ padding: space.md, paddingHorizontal: space.lg }}>
                <View style={{ flex: 1 }}>
                  <Text variant="label" onPress={() => router.push(`/transactions/${l.transactionId}`)}>
                    {formatDateLabel(l.date)}
                    {l.merchantName ? ` · ${l.merchantName}` : ''}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {l.quantityMilli !== null ? `${formatQuantity(l.quantityMilli)}${l.unit ? ` ${l.unit}` : ''}` : 'no quantity'}
                    {l.normalisedPriceMinor !== null ? ` · ${formatMoney(l.normalisedPriceMinor)}/${s.groups.find((g) => g.group === l.group)?.unitLabel}` : ''}
                  </Text>
                </View>
                <Text variant="label">{l.totalMinor === null ? '—' : formatMoney(l.totalMinor)}</Text>
              </Row>
            </View>
          ))}
        </Card>

        <SectionHeader title="Manage" />
        <RenameMerge
          kind="product"
          name={p.name}
          candidates={all.filter((x) => x.id !== p.id)}
          busy={rename.isPending || merge.isPending}
          mergeNote="Each purchase keeps the name, quantity and unit it was recorded with."
          onRename={(name) => rename.mutate(name, { onError: (e) => Alert.alert('Could not rename', e.message) })}
          onMerge={(target) =>
            merge.mutate(target, {
              onSuccess: () => router.replace(`/products/${target}`),
              onError: (e) => Alert.alert('Could not merge', e.message),
            })
          }
        />
      </ScrollView>
    </>
  );
}
