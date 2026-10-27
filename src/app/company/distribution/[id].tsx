import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { SourcePicker, type Source } from '@/components/entry-pickers';
import { formatDateLabel, todayISO } from '@/domain/dates';
import { formatBp, formatMoney, minorToInput, parseAmount } from '@/domain/money';
import { useAccountBalances, useDistribution, useDividendCandidates, useLedgerMutation, useLiabilities } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import {
  cancelDistribution,
  linkDistributionPayment,
  payDistribution,
  unlinkDistributionPayment,
  type LinkDistributionInput,
  type PayDistributionInput,
} from '@/services/distributions';
import { DateField, TextField } from '@/ui/fields';
import { Amount, Banner, Button, Card, Divider, EmptyState, IconButton, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const isOver = (e: Error) => e.name === 'OverDistributionError';

function Line({ label, minor, tint, strong }: { label: string; minor: number; tint?: string; strong?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text variant={strong ? 'bodyStrong' : 'label'} tone={strong ? undefined : 'muted'}>
        {label}
      </Text>
      <Amount minor={minor} variant={strong ? 'bodyStrong' : 'label'} color={tint} />
    </Row>
  );
}

export default function DistributionScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useDistribution(id);
  const accounts = useAccountBalances().data;
  const companyId = q.data?.companyId;
  const candidates = useDividendCandidates(companyId);
  const liabilities = useLiabilities(companyId);
  const [from, setFrom] = useState<Source | null>(null);
  const [to, setTo] = useState<Source | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const pay = useLedgerMutation((db, input: PayDistributionInput) => payDistribution(db, input));
  const link = useLedgerMutation((db, input: LinkDistributionInput) => linkDistributionPayment(db, input));
  const unlink = useLedgerMutation((db, paymentId: string) => unlinkDistributionPayment(db, paymentId));
  const cancel = useLedgerMutation((db, distId: string) => cancelDistribution(db, distId));

  if (q.isLoading || !accounts) return <Loading />;
  const d = q.data;
  if (!d) return <EmptyState icon="error" title="Distribution not found" />;

  const distributionId = d.id;
  const companyAccounts = accounts.filter((a) => a.companyId === d.companyId && a.kind !== 'credit_card');
  const personalAccounts = accounts.filter((a) => a.ownership === 'personal' && a.kind !== 'credit_card');
  const amountMinor = amount.trim() ? parseAmount(amount) : d.outstandingMinor;
  const linked = (liabilities.data ?? []).filter((l) => l.distributionId === d.id);
  const live = d.status !== 'cancelled';

  // Over-payment needs an explicit confirmation, then the same call is retried with allowExcess.
  const runPay = (input: PayDistributionInput) =>
    pay.mutate(input, {
      onSuccess: () => {
        setAmount('');
        setFrom(null);
        setTo(null);
      },
      onError: (e) =>
        isOver(e)
          ? confirmAction('Pay more than was approved?', e.message, 'Pay anyway', () => runPay({ ...input, allowExcess: true }), true)
          : notify('Could not record the payment', e.message),
    });
  const runLink = (input: LinkDistributionInput) =>
    link.mutate(input, {
      onError: (e) =>
        isOver(e)
          ? confirmAction('Link more than was approved?', e.message, 'Link anyway', () => runLink({ ...input, allowExcess: true }), true)
          : notify('Not possible', e.message),
    });

  const submitPay = () => {
    if (!from || !to || !amountMinor) {
      notify('Choose the company account, your account and the amount');
      return;
    }
    runPay({ distributionId, fromAccountId: from.accountId, toAccountId: to.accountId, date, amountMinor });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Distribution' }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <Card tone={d.stage === 'paid' ? 'primary' : 'estimate'} style={{ gap: space.xs }}>
          <Text variant="label" color={d.stage === 'paid' ? c.primary : c.estimate}>
            {d.stage === 'paid'
              ? 'Paid — received in your personal account'
              : d.stage === 'cancelled'
                ? 'Cancelled'
                : 'Approved — not yet personal money'}
          </Text>
          <Amount minor={d.stage === 'paid' ? d.paidMinor : d.outstandingMinor} variant="title" color={d.stage === 'paid' ? c.primary : c.estimate} />
          <Text variant="caption" tone="muted">
            Approved {formatDateLabel(d.approvedAt)}
            {d.fiscalYearLabel ? ` · out of ${d.fiscalYearLabel} profit` : ''}
            {d.stage !== 'paid' && d.stage !== 'cancelled' ? ' · still owed to you' : ''}
          </Text>
        </Card>

        <SectionHeader title="Approved" />
        <Card style={{ gap: 4 }}>
          <Line label="Total to all partners (gross)" minor={d.totalGrossMinor} />
          <Line label={`Your share (${formatBp(d.ownershipBp)})`} minor={d.ownerGrossMinor} />
          <Line label={`− Withholding (${formatBp(d.withholdingBp)})`} minor={-d.withholdingMinor} />
          <Line label="Net approved for you" minor={d.netMinor} strong />
          <Divider />
          <Line label="Paid to you (linked transfers)" minor={d.paidMinor} tint={c.primary} />
          <Line label="Still to pay" minor={d.outstandingMinor} />
          {d.excessMinor > 0 && <Line label="Paid above the approval" minor={d.excessMinor} tint={c.negative} strong />}
        </Card>
        {d.excessMinor > 0 && (
          <View style={{ marginTop: space.sm }}>
            <Banner tone="danger" title="More paid than approved">
              Record an amended approval, or correct the transfers. The extra is still counted once, as personal income from the transfer.
            </Banner>
          </View>
        )}
        {d.notes && (
          <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
            {d.notes}
          </Text>
        )}

        <SectionHeader title="Dividend transfers" />
        <Card padded={false}>
          {d.payments.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text tone="muted">No transfer linked yet.</Text>
            </View>
          ) : (
            d.payments.map((p, i) => (
              <View key={p.id}>
                {i > 0 && <Divider inset={space.lg} />}
                <Row style={{ paddingRight: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <ListItem
                      title={formatMoney(p.amountMinor)}
                      subtitle={`${formatDateLabel(p.date)}${p.transferClass !== 'dividend' ? ' · no longer classified as a dividend' : ''}`}
                      onPress={() => router.push(`/transactions/${p.transactionId}`)}
                    />
                  </View>
                  <IconButton
                    icon="link_off"
                    label="Unlink transfer"
                    color={c.textMuted}
                    onPress={() =>
                      confirmAction('Unlink this transfer?', 'The transfer stays recorded (and stays your income); it just no longer pays this distribution.', 'Unlink', () =>
                        unlink.mutate(p.id),
                      )
                    }
                  />
                </Row>
              </View>
            ))
          )}
        </Card>

        {live && d.outstandingMinor > 0 && (
          <>
            <SectionHeader title="Record the payment" />
            <Card>
              <SourcePicker label="From the company account" accounts={companyAccounts} value={from} onChange={setFrom} />
              <SourcePicker label="To your account" accounts={personalAccounts} value={to} onChange={setTo} />
              <TextField
                label="Net amount transferred"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder={minorToInput(d.outstandingMinor)}
                error={amount.trim() && amountMinor === null ? 'Not a valid amount' : null}
              />
              <DateField value={date} onChange={setDate} minimumDate={d.approvedAt} />
              <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
                Records one company → personal transfer classified as a dividend and links it here. That transfer is what adds the money to
                your personal total and your income — once.
              </Text>
              <Button kind="business" icon="payments" label={`Pay ${formatMoney(amountMinor ?? 0)}`} onPress={submitPay} loading={pay.isPending} />
            </Card>

            {(candidates.data ?? []).length > 0 && (
              <>
                <SectionHeader title="…or link a dividend transfer already recorded" />
                <Card padded={false}>
                  {candidates.data!.map((t, i) => (
                    <View key={t.transactionId}>
                      {i > 0 && <Divider inset={space.lg} />}
                      <ListItem
                        title={formatMoney(t.amountMinor)}
                        subtitle={`${formatDateLabel(t.date)} · to ${t.toName}`}
                        right={<Text variant="label" color={c.primary}>Link</Text>}
                        onPress={() => runLink({ distributionId, transactionId: t.transactionId })}
                      />
                    </View>
                  ))}
                </Card>
              </>
            )}
          </>
        )}

        {linked.length > 0 && (
          <>
            <SectionHeader title="Company obligations from this approval" />
            <Card padded={false}>
              {linked.map((l, i) => (
                <View key={l.id}>
                  {i > 0 && <Divider inset={space.lg} />}
                  <ListItem
                    title={l.label}
                    subtitle={l.status === 'paid' ? 'Paid' : `${formatMoney(l.outstandingMinor)} outstanding`}
                    right={<Amount minor={l.amountMinor} variant="label" />}
                    onPress={() => router.push(`/company/obligation/${l.id}`)}
                    chevron
                  />
                </View>
              ))}
            </Card>
          </>
        )}

        {live && d.payments.length === 0 && (
          <Button
            kind="danger"
            label="Cancel this approval"
            style={{ marginTop: space.xl }}
            onPress={() =>
              confirmAction('Cancel this approval?', 'It and its unpaid obligations are removed from what the company owes. Nothing else changes.', 'Cancel approval', () =>
                cancel.mutate(distributionId, { onError: (e) => notify('Not possible', e.message) }),
              true)
            }
          />
        )}
      </ScrollView>
    </>
  );
}
