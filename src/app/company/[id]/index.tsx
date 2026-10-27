import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { CheckList, EstimatePill, FigureRow } from '@/components/company';
import { formatDateLabel } from '@/domain/dates';
import { formatBp, formatMoney } from '@/domain/money';
import { liabilityKindLabel } from '@/domain/types';
import { useCompanyDashboard, useLedgerMutation } from '@/hooks/data';
import { notify } from '@/lib/confirm';
import { fiscalYearBounds, saveFiscalYear } from '@/services/company';
import { Icon } from '@/ui/icon';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconButton, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

function Action({ icon, label, href }: { icon: string; label: string; href: Href }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, { backgroundColor: c.surface, borderColor: c.border }, pressed && { opacity: 0.8 }]}>
      <Icon name={icon} size={22} color={c.business} />
      <Text variant="label" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function CompanyDashboardScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useCompanyDashboard(id);
  const createYear = useLedgerMutation((db, v: { companyId: string; startMonth: number }) => {
    const b = fiscalYearBounds(v.startMonth);
    return saveFiscalYear(db, { companyId: v.companyId, label: b.label, startDate: b.startDate, endDate: b.endDate });
  });

  if (q.isLoading) return <Loading />;
  const d = q.data;
  if (!d) return <EmptyState icon="error" title="Company not found" />;

  const { company, position: p, report, payout } = d;
  const fy = d.fiscalYear;
  const status = report?.status;
  const estimate = report?.estimate;
  const open = d.liabilities.filter((l) => l.outstandingMinor > 0).slice(0, 4);
  const suggested = fiscalYearBounds(company.fiscalYearStartMonth);

  return (
    <>
      <Stack.Screen
        options={{
          title: company.name,
          headerRight: () => <IconButton icon="tune" label="Company settings" onPress={() => router.push('/settings')} />,
        }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.bg }}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        <Card tone="business" style={{ gap: space.xs }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label" color={c.business}>
              {company.legalForm} · company money
            </Text>
            <Icon name="domain" size={18} color={c.business} />
          </Row>
          <Text variant="caption" tone="muted">
            Belongs to the company, not to you. Bank balance, profit, distributable profit, approved and received distributions are
            separate figures below. Your {formatBp(company.ownershipBp)} ownership is a share of distributions the partners decide — not a
            right to {formatBp(company.ownershipBp)} of the company’s cash.
          </Text>
        </Card>

        <SectionHeader title="Position today" />
        <Card style={{ paddingVertical: space.sm }}>
          <FigureRow
            label="1 · Cash & bank"
            minor={p.cashMinor}
            tint={c.business}
            hint={`Bank ${formatMoney(p.bankMinor)} · cash and other ${formatMoney(p.cashOnHandMinor)}${d.summary.unconverted.length ? ` · ${d.summary.unconverted.length} location(s) without an exchange rate not counted` : ''}`}
          />
          <Divider />
          <FigureRow
            label="2 · Outstanding obligations"
            minor={-p.obligationsMinor}
            tint={p.obligationsMinor ? c.negative : undefined}
            hint={p.obligationLines.length ? p.obligationLines.map((l) => `${l.label} ${formatMoney(l.amountMinor)}`).join(' · ') : 'Nothing recorded as owed'}
            onPress={() => router.push(`/company/${company.id}/obligations`)}
          />
          <Divider />
          <FigureRow
            label="3 · Reserved / restricted funds"
            minor={-p.reservedMinor}
            tint={p.reservedMinor ? c.negative : undefined}
            hint="Company cash you set aside (profit reserves are counted under distributable profit)"
            onPress={() => router.push(`/company/${company.id}/obligations`)}
          />
          <Divider />
          <FigureRow
            label="4 · Estimated liquidity after obligations"
            minor={p.liquidityMinor}
            strong
            tint={p.liquidityMinor < 0 ? c.negative : c.business}
            hint={`${formatMoney(p.cashMinor)} − ${formatMoney(p.obligationsMinor)} − ${formatMoney(p.reservedMinor)}. Recorded obligations only${d.unrecordedIsMinor ? `; about ${formatMoney(d.unrecordedIsMinor)} estimated IS is not recorded yet` : ''}.`}
          />
        </Card>

        <SectionHeader title={fy ? `Profit · fiscal year ${fy.label}` : 'Profit'} action={fy ? { label: 'Tax estimate', onPress: () => router.push(`/company/${company.id}/tax`) } : undefined} />
        {!fy ? (
          <Card style={{ gap: space.md }}>
            <Text tone="muted">
              Profit and taxes are worked out per fiscal year. Create the current one ({formatDateLabel(suggested.startDate)} –{' '}
              {formatDateLabel(suggested.endDate)}) to start.
            </Text>
            <Row>
              <Button
                kind="business"
                compact
                icon="add"
                label={`Create ${suggested.label}`}
                loading={createYear.isPending}
                onPress={() =>
                  createYear.mutate({ companyId: company.id, startMonth: company.fiscalYearStartMonth }, { onError: (e) => notify('Could not create', e.message) })
                }
              />
              <Button compact kind="ghost" label="Other dates" onPress={() => router.push(`/company/fiscal-year?companyId=${company.id}`)} />
            </Row>
          </Card>
        ) : (
          <Card style={{ paddingVertical: space.sm }}>
            <FigureRow
              label={`5 · Accounting profit before tax${status?.yearToDate ? ' (year to date)' : ''}`}
              minor={status?.complete && estimate ? estimate.accountingProfitMinor : null}
              missing="Not enough data"
              tint={estimate && estimate.accountingProfitMinor < 0 ? c.negative : undefined}
              hint={
                status?.complete
                  ? 'Revenue − deductible expenses (HT), cash basis, from recorded transactions.'
                  : (status?.reasons.join(' ') ?? '')
              }
              onPress={() => router.push(`/company/${company.id}/tax`)}
            />
            <Divider />
            <FigureRow
              label="6 · Estimated distributable profit"
              minor={status?.complete && estimate ? estimate.remainingDistributableMinor : null}
              missing={status?.complete ? 'Enter assumptions' : 'Not enough data'}
              tint={c.estimate}
              hint={
                status?.complete && estimate?.remainingDistributableMinor !== null && estimate
                  ? `Profit after tax − reserves${estimate.approvedMinor ? ` − ${formatMoney(estimate.approvedMinor)} already approved` : ''}. Profit, not cash.`
                  : (estimate?.missing.length ? `Missing: ${estimate.missing.join(', ')}.` : 'Needs complete figures for the year.')
              }
              onPress={() => router.push(`/company/${company.id}/tax`)}
            />
            <Divider />
            <FigureRow
              label="7 · Estimated owner share after withholding"
              minor={payout.estimatedNetMinor}
              missing="Not available"
              tint={c.estimate}
              hint={
                payout.estimatedNetMinor !== null
                  ? payout.calculation.slice(-2).join(' ')
                  : status && !status.complete
                    ? 'Needs complete figures for the year (see 5).'
                    : payout.missing.join(' ')
              }
              onPress={() => router.push(`/company/${company.id}/simulate`)}
            />
            <Row style={{ paddingTop: space.xs }}>
              <EstimatePill label="6 and 7 are estimates — not money" />
            </Row>
            {payout.approvedUnpaidMinor > 0 && (
              <>
                <Divider />
                <FigureRow
                  label="Approved distribution, not yet paid to you"
                  minor={payout.approvedUnpaidMinor}
                  tint={c.estimate}
                  hint="Decided, but it becomes your money only when the dividend transfer is made."
                  onPress={() => router.push(`/company/${company.id}/distributions`)}
                />
              </>
            )}
          </Card>
        )}

        {d.checks.length > 0 && (
          <>
            <SectionHeader title="Needs attention" />
            <CheckList checks={d.checks} />
          </>
        )}

        <SectionHeader title="Manage" />
        <View style={styles.actions}>
          <Action icon="calculate" label="Tax estimate" href={`/company/${company.id}/tax`} />
          <Action icon="pending_actions" label="Obligations" href={`/company/${company.id}/obligations`} />
          <Action icon="science" label="Simulator" href={`/company/${company.id}/simulate`} />
          <Action icon="payments" label="Distributions" href={`/company/${company.id}/distributions`} />
          <Action icon="bar_chart" label="Analytics" href={`/company/${company.id}/analytics`} />
          <Action icon="receipt_long" label="Activity" href={{ pathname: '/transactions', params: { companyId: company.id, label: company.name } }} />
        </View>

        {open.length > 0 && (
          <>
            <SectionHeader title="Next obligations" action={{ label: 'All', onPress: () => router.push(`/company/${company.id}/obligations`) }} />
            <Card padded={false}>
              {open.map((l, i) => (
                <View key={l.id}>
                  {i > 0 && <Divider inset={68} />}
                  <ListItem
                    icon={l.overdue ? 'error' : 'event'}
                    iconColor={l.overdue ? c.negative : l.dueSoon ? c.warning : c.business}
                    title={l.label}
                    subtitle={`${liabilityKindLabel(l.kind)}${l.dueDate ? ` · due ${formatDateLabel(l.dueDate)}` : ''}${l.overdue ? ` · ${l.daysOverdue} days late` : ''}`}
                    right={<Amount minor={l.outstandingMinor} currency={l.currency} />}
                    onPress={() => router.push(`/company/obligation/${l.id}`)}
                  />
                </View>
              ))}
            </Card>
          </>
        )}

        {d.summary.accounts.length === 0 && (
          <View style={{ marginTop: space.lg }}>
            <Banner tone="info" title="No company money locations">
              Add the company’s bank account or cash box from My Money → Add location, as company money.
            </Banner>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: {
    flexBasis: '31%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
