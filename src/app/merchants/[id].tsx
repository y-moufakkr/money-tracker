import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, View } from 'react-native';

import { BarRow } from '@/components/breakdown';
import { ColumnChart } from '@/components/charts';
import { RenameMerge } from '@/components/rename-merge';
import { bucketRange, formatDateLabel, formatMonthLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useLedgerMutation, useMerchant, useMerchants } from '@/hooks/data';
import { openTransactions } from '@/lib/drill';
import { mergeMerchant, renameMerchant, setMerchantArchived } from '@/services/catalog';
import { Button, Card, Divider, EmptyState, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function MerchantScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: m, isLoading } = useMerchant(id);
  const all = useMerchants('').data ?? [];
  const rename = useLedgerMutation((db, name: string) => renameMerchant(db, id, name));
  const merge = useLedgerMutation((db, target: string) => mergeMerchant(db, id, target));
  const archive = useLedgerMutation((db, v: boolean) => setMerchantArchived(db, id, v));

  if (isLoading) return <Loading />;
  if (!m) return <EmptyState icon="error" title="Merchant not found" message="It may have been merged into another merchant." />;
  const drill = { merchantId: m.id, kinds: ['expense' as const], ownership: 'personal' as const };
  const thisMonth = m.months[m.months.length - 1];

  return (
    <>
      <Stack.Screen options={{ title: m.name }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <Card tone="primary" style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md }}>
            {[
              ['Total spent', formatMoney(m.totalMinor)],
              ['Visits', String(m.visits)],
              ['Average ticket', m.averageTicketMinor === null ? '—' : formatMoney(m.averageTicketMinor)],
              ['This month', formatMoney(thisMonth.totalMinor)],
            ].map(([label, value]) => (
              <View key={label} style={{ flexBasis: '50%', gap: 2 }}>
                <Text variant="caption" tone="muted">
                  {label}
                </Text>
                <Text variant="heading" style={{ fontVariant: ['tabular-nums'] }}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="caption" tone="muted">
            Personal expenses{m.firstVisit ? ` since ${formatDateLabel(m.firstVisit)}` : ''}. Average ticket = total ÷ visits.
          </Text>
        </Card>
        <Button kind="ghost" icon="receipt_long" label="Show all transactions" onPress={() => openTransactions(drill, m.name)} />

        <SectionHeader title="Monthly spending (12 months)" />
        <Card>
          <ColumnChart
            points={m.months.map((x) => ({ label: `${formatMonthLabel(x.month)} · ${x.visits} visit${x.visits === 1 ? '' : 's'}`, value: x.totalMinor }))}
            onPress={(i) => {
              const r = bucketRange('month', m.months[i].month);
              if (m.months[i].visits > 0) openTransactions({ ...drill, ...r }, `${m.name} · ${formatMonthLabel(r.from)}`);
            }}
          />
          <Text variant="caption" tone="faint" style={{ marginTop: space.sm }}>
            Tap a month with visits to see its transactions.
          </Text>
        </Card>

        {m.categories.length > 0 && (
          <>
            <SectionHeader title="What you buy here" />
            <Card style={{ gap: space.md }}>
              {m.categories.map((cat) => (
                <BarRow key={cat.key} label={cat.label} minor={cat.totalMinor} max={m.categories[0].totalMinor} color={cat.color ?? c.primary} detail={`${cat.count}×`} />
              ))}
            </Card>
          </>
        )}

        {m.products.length > 0 && (
          <>
            <SectionHeader title="Products and latest prices here" />
            <Card padded={false}>
              {m.products.map((p, i) => (
                <View key={p.id}>
                  {i > 0 && <Divider inset={space.lg} />}
                  <ListItem
                    title={p.name}
                    subtitle={`${p.purchaseCount}× · ${formatMoney(p.spentMinor)}${p.latestPrice ? ` · ${formatDateLabel(p.latestPrice.date)}` : ''}`}
                    right={
                      p.latestPrice ? (
                        <Text variant="label">
                          {formatMoney(p.latestPrice.priceMinor)}/{p.latestPrice.unitLabel}
                        </Text>
                      ) : undefined
                    }
                    chevron
                    onPress={() => router.push(`/products/${p.id}`)}
                  />
                </View>
              ))}
            </Card>
            <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
              Open a product to compare its price across merchants.
            </Text>
          </>
        )}

        <SectionHeader title="Manage" />
        <RenameMerge
          kind="merchant"
          name={m.name}
          candidates={all.filter((x) => x.id !== m.id)}
          busy={rename.isPending || merge.isPending}
          onRename={(name) => rename.mutate(name, { onError: (e) => Alert.alert('Could not rename', e.message) })}
          onMerge={(target) =>
            merge.mutate(target, {
              onSuccess: () => router.replace(`/merchants/${target}`),
              onError: (e) => Alert.alert('Could not merge', e.message),
            })
          }
        />
        <Row style={{ marginTop: space.md }}>
          <Button
            kind="secondary"
            compact
            icon={m.isArchived ? 'unarchive' : 'archive'}
            label={m.isArchived ? 'Show in suggestions again' : 'Hide from suggestions'}
            onPress={() => archive.mutate(!m.isArchived)}
          />
        </Row>
      </ScrollView>
    </>
  );
}
