import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { CheckList } from '@/components/company';
import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useCompanyDashboard } from '@/hooks/data';
import type { Distribution } from '@/services/distributions';
import { Amount, Button, Card, Divider, EmptyState, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const STAGE_LABEL: Record<Distribution['stage'], string> = {
  approved: 'Approved · not paid',
  partially_paid: 'Partly paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export default function DistributionsScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useCompanyDashboard(id);
  if (q.isLoading) return <Loading />;
  const d = q.data;
  if (!d) return <EmptyState icon="error" title="Company not found" />;
  const checks = d.checks.filter((x) => x.id === 'dividend-without-approval' || x.id.startsWith('over-') || x.id.startsWith('class-'));
  const received = d.distributions.reduce((s, x) => s + x.paidMinor, 0);

  return (
    <>
      <Stack.Screen options={{ title: 'Distributions' }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
        <Card style={{ gap: space.sm }}>
          <Text variant="caption" tone="muted">
            Simulated → approved (recorded, still not your money) → paid (a real company → personal dividend transfer, which is the only
            step that adds to your money).
          </Text>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label" tone="muted">Approved, not yet paid to you</Text>
            <Amount minor={d.payout.approvedUnpaidMinor} variant="label" color={c.estimate} />
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label" tone="muted">Received by you (all time)</Text>
            <Amount minor={received} variant="label" color={c.primary} />
          </Row>
          <Row>
            <Button compact kind="secondary" icon="science" label="Simulate" onPress={() => router.push(`/company/${d.company.id}/simulate`)} style={{ flex: 1 }} />
            <Button compact kind="business" icon="gavel" label="Record approval" onPress={() => router.push(`/company/approve?companyId=${d.company.id}`)} style={{ flex: 1 }} />
          </Row>
        </Card>

        {checks.length > 0 && (
          <>
            <SectionHeader title="Check" />
            <CheckList checks={checks} />
          </>
        )}

        <SectionHeader title="Approved distributions" />
        <Card padded={false}>
          {d.distributions.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text tone="muted">None recorded.</Text>
            </View>
          ) : (
            d.distributions.map((x, i) => (
              <View key={x.id}>
                {i > 0 && <Divider inset={68} />}
                <ListItem
                  icon={x.stage === 'paid' ? 'check_circle' : x.stage === 'cancelled' ? 'block' : 'gavel'}
                  iconColor={x.excessMinor > 0 ? c.negative : x.stage === 'paid' ? c.positive : x.stage === 'cancelled' ? c.textFaint : c.estimate}
                  title={`${formatMoney(x.netMinor)} net to you`}
                  subtitle={`${STAGE_LABEL[x.stage]} · approved ${formatDateLabel(x.approvedAt)}${x.fiscalYearLabel ? ` · ${x.fiscalYearLabel} profit` : ''}${x.excessMinor ? ` · ${formatMoney(x.excessMinor)} over` : ''}`}
                  right={<Amount minor={x.totalGrossMinor} variant="label" color={c.textMuted} />}
                  onPress={() => router.push(`/company/distribution/${x.id}`)}
                  chevron
                />
              </View>
            ))
          )}
        </Card>
        <Text variant="caption" tone="faint" style={{ marginTop: space.sm }}>
          The amount on the right is the total approved for all partners (gross).
        </Text>
      </ScrollView>
    </>
  );
}
