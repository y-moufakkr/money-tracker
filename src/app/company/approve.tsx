import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { PayoutResult } from '@/components/company';
import { addMonths, todayISO } from '@/domain/dates';
import { BASE_CURRENCY, bpToInput, formatMoney, minorToInput, parseAmount, parsePercentBp } from '@/domain/money';
import type { Company, FiscalYear } from '@/domain/types';
import { useCompany, useFiscalYearReport, useFiscalYears, useLedgerMutation } from '@/hooks/data';
import { notify } from '@/lib/confirm';
import { approveDistribution, simulateDistribution, type ApproveInput } from '@/services/distributions';
import { AmountInput, ChipGroup, DateButton, DateField, Field, TextField, Toggle } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Banner, Button, Chip, EmptyState, Loading, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const FAR = '2100-12-31';

export default function ApproveScreen() {
  const p = useLocalSearchParams<{ companyId: string; fy?: string; total?: string; own?: string; wh?: string; sim?: string }>();
  const company = useCompany(p.companyId);
  const years = useFiscalYears(p.companyId);
  if (company.isLoading || years.isLoading) return <Loading />;
  if (!company.data) return <EmptyState icon="error" title="Company not found" />;
  const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : null);
  return (
    <ApproveForm
      company={company.data}
      years={years.data ?? []}
      initial={{ fy: p.fy || null, total: num(p.total), own: num(p.own), wh: num(p.wh), sim: p.sim || null }}
    />
  );
}

function ApproveForm({
  company,
  years,
  initial,
}: {
  company: Company;
  years: FiscalYear[];
  initial: { fy: string | null; total: number | null; own: number | null; wh: number | null; sim: string | null };
}) {
  const c = useColors();
  const [fyId, setFyId] = useState<string | null>(initial.fy ?? years[0]?.id ?? null);
  const [date, setDate] = useState(todayISO());
  const [total, setTotal] = useState(initial.total ? minorToInput(initial.total) : '');
  const [own, setOwn] = useState(bpToInput(initial.own ?? company.ownershipBp));
  const [wh, setWh] = useState(initial.wh !== null ? bpToInput(initial.wh) : '');
  const [createObligations, setCreateObligations] = useState(true);
  const [due, setDue] = useState(addMonths(todayISO(), 1));
  const [notes, setNotes] = useState('');
  const report = useFiscalYearReport(fyId ?? undefined);
  const approve = useLedgerMutation((db, input: ApproveInput) => approveDistribution(db, input));

  const totalMinor = total.trim() ? parseAmount(total) : null;
  const ownBp = parsePercentBp(own);
  const whBp = wh.trim() ? parsePercentBp(wh) : null;
  const preview =
    totalMinor && ownBp !== null && whBp !== null
      ? simulateDistribution({ distributableMinor: totalMinor, ownershipBp: ownBp, withholdingBp: whBp, proposedMinor: totalMinor })
      : null;
  const remaining = report.data?.status.complete ? report.data.estimate.remainingDistributableMinor : null;

  const companyId = company.id;
  const simulationId = initial.sim;
  const submit = () => {
    if (!totalMinor || ownBp === null || whBp === null) {
      notify('Enter the total distribution, your ownership and the withholding rate');
      return;
    }
    approve.mutate(
      {
        companyId,
        fiscalYearId: fyId,
        simulationId,
        approvedAt: date,
        totalGrossMinor: totalMinor,
        ownershipBp: ownBp,
        withholdingBp: whBp,
        notes,
        createObligations,
        obligationsDueDate: createObligations ? due : null,
      },
      {
        onSuccess: (id) => router.replace(`/company/distribution/${id}`),
        onError: (e) => notify('Could not record the approval', e.message),
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Record approval' }} />
      <FormScreen footer={<Button kind="business" label="Record approval" icon="gavel" onPress={submit} loading={approve.isPending} style={{ flex: 1 }} />}>
        <Banner tone="info">
          Record a distribution the partners have approved (e.g. at the annual general meeting). It becomes a company obligation; it is not
          your money until the dividend transfer is made.
        </Banner>
        <View style={{ height: space.md }} />
        <AmountInput value={total} onChangeText={setTotal} currency={BASE_CURRENCY} tint={c.business} accessibilityLabel="Total distribution approved" />
        <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: -space.md, marginBottom: space.md }}>
          Total distribution to all partners (gross)
        </Text>
        {years.length > 0 && (
          <Field label="Out of the profit of">
            <ChipGroup>
              {years.map((y) => (
                <Chip key={y.id} label={y.label} selected={fyId === y.id} onPress={() => setFyId(y.id)} color={c.business} />
              ))}
            </ChipGroup>
          </Field>
        )}
        {remaining !== null && totalMinor !== null && totalMinor > remaining && (
          <View style={{ marginBottom: space.md }}>
            <Banner tone="warning" title="Above the estimate">
              {`The estimated profit not yet distributed for this year is ${formatMoney(remaining)}. Check the figures with your accountant before recording more.`}
            </Banner>
          </View>
        )}
        <DateField label="Approved on" value={date} onChange={setDate} />
        <TextField label="Your ownership" value={own} onChangeText={setOwn} keyboardType="decimal-pad" trailing={<Text tone="muted">%</Text>} error={ownBp === null ? '0–100, up to 2 decimals' : null} />
        <TextField label="Withholding rate" value={wh} onChangeText={setWh} keyboardType="decimal-pad" placeholder="e.g. 12.5" trailing={<Text tone="muted">%</Text>} error={wh.trim() && whBp === null ? '0–100, up to 2 decimals' : null} />
        {preview && <PayoutResult netMinor={preview.netMinor} grossMinor={preview.ownerGrossMinor} withholdingMinor={preview.withholdingMinor} />}
        <View style={{ height: space.md }} />
        <Toggle
          label="Record what else the company owes"
          description={
            preview
              ? `Withholding ${formatMoney(preview.withholdingMinor)}${preview.othersMinor > 0 ? ` and ${formatMoney(preview.othersMinor)} to other partners` : ''}, as obligations to pay.`
              : 'Withholding on your share and other partners’ shares, as obligations to pay.'
          }
          value={createObligations}
          onChange={setCreateObligations}
        />
        {createObligations && (
          <View style={{ marginVertical: space.sm }}>
            <DateButton label="Due" value={due} maximumDate={FAR} onChange={setDue} />
          </View>
        )}
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="e.g. AGM of 15 May" />
      </FormScreen>
    </>
  );
}
