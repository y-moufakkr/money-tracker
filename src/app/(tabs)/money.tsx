import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AccountRow } from '@/components/account-row';
import { Breakdown } from '@/components/breakdown';
import { ThreeTotalsCard } from '@/components/three-totals';
import { formatDateLabel, isoToLocalDate, localDateToISO, todayISO } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useMoneySummary, useThreeTotals } from '@/hooks/data';
import { Icon } from '@/ui/icon';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconButton, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { TabScreen } from '@/ui/layout';
import { radius, SERIES, space, useColors } from '@/ui/theme';

function Tile({ label, minor, tint, hint, onPress }: { label: string; minor: number; tint?: string; hint?: string; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={[styles.tile, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Amount minor={minor} variant="heading" color={tint} />
      {hint && (
        <Text variant="caption" tone="faint">
          {hint}
        </Text>
      )}
    </Pressable>
  );
}

function QuickAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} style={styles.quick} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.quickIcon, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Icon name={icon} size={22} color={c.primary} />
      </View>
      <Text variant="caption" style={{ textAlign: 'center' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function MoneyScreen() {
  const c = useColors();
  const today = todayISO();
  const [asOf, setAsOf] = useState(today);
  const [iosPicker, setIosPicker] = useState(false);
  const { data, isLoading, refetch, isRefetching } = useMoneySummary(asOf === today ? undefined : asOf);
  const totals = useThreeTotals();
  const historical = asOf !== today;

  const pickDate = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: isoToLocalDate(asOf),
        mode: 'date',
        maximumDate: isoToLocalDate(today),
        onChange: (e, d) => e.type === 'set' && d && setAsOf(localDateToISO(d)),
      });
    } else setIosPicker((v) => !v);
  };

  const p = data?.personal;
  const hasAccounts = (p?.accounts.length ?? 0) + (data?.companies.length ?? 0) > 0;

  const slices =
    p?.accounts
      .filter((a) => a.kind !== 'credit_card' && (a.baseMinor ?? 0) > 0)
      .sort((a, b) => (b.baseMinor ?? 0) - (a.baseMinor ?? 0))
      .map((a, i) => ({ key: a.id, label: a.name, minor: a.baseMinor ?? 0, color: SERIES[i % SERIES.length] })) ?? [];

  return (
    <TabScreen
      title="My Money"
      subtitle={historical ? `Balances at end of ${formatDateLabel(asOf)}` : 'Where every dirham is'}
      refreshing={isRefetching}
      onRefresh={refetch}
      headerRight={<IconButton icon="history" label="View balances on a past date" onPress={pickDate} />}>
      {iosPicker && Platform.OS !== 'android' && (
        <DateTimePicker
          value={isoToLocalDate(asOf)}
          mode="date"
          display="inline"
          maximumDate={isoToLocalDate(today)}
          onChange={(_, d) => d && setAsOf(localDateToISO(d))}
        />
      )}
      {historical && (
        <View style={{ marginBottom: space.md }}>
          <Banner tone="info" icon="history" title={`Historical view: ${formatDateLabel(asOf)}`}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="label" tone="muted" style={{ flex: 1 }}>
                Calculated from recorded transactions up to that day.
              </Text>
              <Button label="Back to today" kind="ghost" compact onPress={() => setAsOf(today)} />
            </Row>
          </Banner>
        </View>
      )}

      {isLoading || !data || !p ? (
        <Loading />
      ) : !hasAccounts ? (
        <Card>
          <EmptyState
            icon="account_balance_wallet"
            title="Where do you keep your money?"
            message="Add your bank accounts, wallet cash, cash at home, savings and company accounts. Each one gets its own balance."
            action={{ label: 'Add first location', onPress: () => router.push('/accounts/new') }}
          />
        </Card>
      ) : (
        <>
          <Card tone="primary" style={{ gap: space.xs }}>
            <Text variant="label" color={c.primary}>
              My personal money
            </Text>
            <Amount minor={p.liquid} variant="display" />
            <Divider />
            <Row style={{ justifyContent: 'space-between', marginTop: space.sm }}>
              <View>
                <Text variant="caption" tone="muted">
                  {p.reservationsApply ? 'Unallocated (not reserved)' : 'Available'}
                </Text>
                <Amount minor={p.available} variant="bodyStrong" colored="negative-only" />
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="caption" tone="muted">
                  Net after debts
                </Text>
                <Amount minor={p.netLiquid} variant="bodyStrong" colored="negative-only" />
              </View>
            </Row>
          </Card>

          <View style={styles.tiles}>
            <Tile label="Bank accounts" minor={p.bank} />
            <Tile label="Cash (all places)" minor={p.cash} />
            <Tile label="Savings" minor={p.savings} />
            {p.otherLiquid !== 0 && <Tile label="Cards & wallets" minor={p.otherLiquid} />}
            <Tile
              label="Owed (liabilities)"
              minor={p.liabilities}
              tint={p.liabilities > 0 ? c.negative : undefined}
              hint={p.liabilities > 0 ? 'Credit cards' : undefined}
            />
            <Tile
              label="Reserved for goals"
              minor={p.reserved}
              hint={p.reservationsApply ? 'Part of the total above, not extra' : 'Reservations are only tracked for today'}
              onPress={() => router.push('/goals')}
            />
          </View>
          {p.reservationsApply && (
            <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
              Total {formatMoney(p.liquid)} = reserved for goals {formatMoney(p.reserved)} + unallocated {formatMoney(p.available)}. Bills
              reservations come with recurring payments (Phase 5).
            </Text>
          )}
          {p.overAllocated.length > 0 && (
            <View style={{ marginTop: space.md }}>
              <Banner tone="warning" title="Some reservations are not covered">
                {p.overAllocated
                  .map((o) => `${o.account.name}: ${formatMoney(o.allocatedMinor, o.account.currency)} reserved, but only ${formatMoney(o.allocatedMinor - o.shortMinor, o.account.currency)} is there.`)
                  .join('\n')}
              </Banner>
            </View>
          )}

          {p.unconverted.length > 0 && (
            <View style={{ marginTop: space.md }}>
              <Banner tone="warning" title="Not included in totals">
                {`${p.unconverted.map((a) => `${a.name} (${a.currency})`).join(', ')} — add an exchange rate in Settings to include ${p.unconverted.length > 1 ? 'them' : 'it'}.`}
              </Banner>
            </View>
          )}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
            <QuickAction icon="swap_horiz" label="Transfer" onPress={() => router.push('/entry/transfer')} />
            <QuickAction icon="remove" label="Expense" onPress={() => router.push('/entry/expense')} />
            <QuickAction icon="add" label="Income" onPress={() => router.push('/entry/income')} />
            <QuickAction icon="balance" label="Check balance" onPress={() => router.push('/accounts/pick?next=reconcile')} />
            <QuickAction icon="show_chart" label="Trends" onPress={() => router.push('/trends')} />
            <QuickAction icon="flag" label="Goals" onPress={() => router.push('/goals')} />
            <QuickAction icon="add_card" label="Add location" onPress={() => router.push('/accounts/new')} />
          </ScrollView>

          {slices.length > 1 && (
            <>
              <SectionHeader title={`Where it is · ${formatMoney(p.liquid)}`} />
              <Card>
                <Breakdown slices={slices} />
              </Card>
            </>
          )}

          <SectionHeader title="Personal locations" action={{ label: 'Add', onPress: () => router.push('/accounts/new') }} />
          <Card padded={false}>
            {p.accounts.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Text tone="muted">No personal locations yet.</Text>
              </View>
            ) : (
              p.accounts.map((a, i) => (
                <View key={a.id}>
                  {i > 0 && <Divider inset={68} />}
                  <AccountRow account={a} baseMinor={a.baseMinor} />
                </View>
              ))
            )}
          </Card>

          {!historical && totals.data && totals.data.b.length > 0 && (
            <>
              <SectionHeader title="Personal · company · potential payout" />
              <ThreeTotalsCard t={totals.data} />
            </>
          )}

          {data.companies.map((co) => (
            <View key={co.company.id}>
              <SectionHeader title={`Company · ${co.company.name}`} action={{ label: 'Dashboard', onPress: () => router.push(`/company/${co.company.id}`) }} />
              <Card tone="business" style={{ gap: space.xs, marginBottom: space.sm }} onPress={() => router.push(`/company/${co.company.id}`)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="label" color={c.business}>
                    Company cash & bank{historical ? '' : ' today'}
                  </Text>
                  <Icon name="domain" size={18} color={c.business} />
                </Row>
                <Amount minor={co.total} variant="title" color={c.business} />
                <Text variant="caption" tone="muted">
                  Belongs to the company, not to you. Not included in your personal money. Cash is not profit: open the
                  dashboard for obligations, profit and distributable profit.
                </Text>
                {co.unconverted.length > 0 && (
                  <Text variant="caption" color={c.warning}>
                    Excludes {co.unconverted.map((a) => a.name).join(', ')} (no exchange rate).
                  </Text>
                )}
              </Card>
              <Card padded={false}>
                {co.accounts.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 && <Divider inset={68} />}
                    <AccountRow account={a} baseMinor={a.baseMinor} />
                  </View>
                ))}
              </Card>
            </View>
          ))}

          <Pressable onPress={() => router.push('/settings')} style={{ marginTop: space.xl, alignItems: 'center' }}>
            <Text variant="label" tone="muted">
              Archived locations, exchange rates and companies are in Settings
            </Text>
          </Pressable>
        </>
      )}
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  quickRow: { gap: space.lg, paddingVertical: space.lg, paddingHorizontal: space.xs },
  quick: { alignItems: 'center', gap: 6, width: 68 },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
