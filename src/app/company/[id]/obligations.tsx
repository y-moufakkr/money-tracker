import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { LIABILITY_KINDS, RESERVE_KINDS, liabilityKindLabel } from '@/domain/types';
import { useFiscalYears, useLiabilities, useReserves } from '@/hooks/data';
import type { Liability } from '@/services/obligations';
import { Amount, Button, Card, Divider, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

function LiabilityRow({ l }: { l: Liability }) {
  const c = useColors();
  const icon = LIABILITY_KINDS.find((k) => k.kind === l.kind)?.icon ?? 'pending_actions';
  const when = l.dueDate ? `due ${formatDateLabel(l.dueDate)}` : 'no due date';
  const state =
    l.status === 'paid'
      ? 'paid'
      : l.overdue
        ? `${l.daysOverdue} day${l.daysOverdue === 1 ? '' : 's'} overdue`
        : l.status === 'partial'
          ? `${formatMoney(l.paidMinor, l.currency)} of ${formatMoney(l.amountMinor, l.currency)} paid`
          : when;
  return (
    <ListItem
      icon={icon}
      iconColor={l.overdue ? c.negative : l.dueSoon ? c.warning : l.status === 'paid' ? c.positive : c.business}
      title={l.label}
      subtitle={`${liabilityKindLabel(l.kind)} · ${state}`}
      right={<Amount minor={l.status === 'paid' ? l.amountMinor : l.outstandingMinor} currency={l.currency} color={l.status === 'paid' ? c.textMuted : undefined} />}
      onPress={() => router.push(`/company/obligation/${l.id}`)}
      chevron
    />
  );
}

export default function ObligationsScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const liabilities = useLiabilities(id);
  const reserves = useReserves(id);
  const years = useFiscalYears(id);
  const [showPaid, setShowPaid] = useState(false);

  if (liabilities.isLoading || reserves.isLoading) return <Loading />;
  const all = liabilities.data ?? [];
  const open = all.filter((l) => l.outstandingMinor > 0);
  const paid = all.filter((l) => l.outstandingMinor === 0);
  const outstanding = open.reduce((s, l) => s + l.outstandingMinor, 0);
  const fyLabel = (fyId: string | null) => (years.data ?? []).find((y) => y.id === fyId)?.label;

  return (
    <>
      <Stack.Screen options={{ title: 'Obligations & reserves' }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        <Card tone="business" style={{ gap: space.xs }}>
          <Text variant="label" color={c.business}>
            Still owed by the company
          </Text>
          <Amount minor={outstanding} variant="title" color={c.business} />
          <Text variant="caption" tone="muted">
            Each obligation is paid by a real company expense or transfer linked to it. Outstanding = amount − linked payments, so a payment
            is never subtracted twice.
          </Text>
        </Card>
        <Row style={{ marginTop: space.md }}>
          <Button kind="business" icon="add" label="Add obligation" onPress={() => router.push(`/company/obligation-edit?companyId=${id}`)} style={{ flex: 1 }} />
        </Row>

        <SectionHeader title={`Open (${open.length})`} />
        <Card padded={false}>
          {open.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text tone="muted">Nothing outstanding. Add taxes, TVA, payroll, CNSS or supplier bills the company owes.</Text>
            </View>
          ) : (
            open.map((l, i) => (
              <View key={l.id}>
                {i > 0 && <Divider inset={68} />}
                <LiabilityRow l={l} />
              </View>
            ))
          )}
        </Card>

        {paid.length > 0 && (
          <>
            <SectionHeader title={`Paid (${paid.length})`} action={{ label: showPaid ? 'Hide' : 'Show', onPress: () => setShowPaid((v) => !v) }} />
            {showPaid && (
              <Card padded={false}>
                {paid.map((l, i) => (
                  <View key={l.id}>
                    {i > 0 && <Divider inset={68} />}
                    <LiabilityRow l={l} />
                  </View>
                ))}
              </Card>
            )}
          </>
        )}

        <SectionHeader title="Reserves" action={{ label: 'Add', onPress: () => router.push(`/company/reserve-edit?companyId=${id}`) }} />
        <Card padded={false}>
          {(reserves.data ?? []).length === 0 ? (
            <View style={{ padding: space.lg, gap: space.xs }}>
              <Text tone="muted">No reserves.</Text>
              {RESERVE_KINDS.map((k) => (
                <Text key={k.kind} variant="caption" tone="muted">
                  • {k.label}: {k.hint}
                </Text>
              ))}
            </View>
          ) : (
            reserves.data!.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Divider inset={68} />}
                <ListItem
                  icon={r.kind === 'cash' ? 'lock' : 'account_balance'}
                  iconColor={c.business}
                  title={r.name}
                  subtitle={`${RESERVE_KINDS.find((k) => k.kind === r.kind)?.label}${r.fiscalYearId ? ` · ${fyLabel(r.fiscalYearId) ?? ''} profit` : ' · restricts cash'}`}
                  right={<Amount minor={r.amountMinor} />}
                  onPress={() => router.push(`/company/reserve-edit?companyId=${id}&id=${r.id}`)}
                  chevron
                />
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </>
  );
}
