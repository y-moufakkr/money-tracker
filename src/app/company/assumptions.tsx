import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { bpToInput, minorToInput, parseAmount, parsePercentBp, parseSignedAmount } from '@/domain/money';
import type { TaxAssumptions, TvaMode } from '@/domain/types';
import { useFiscalYearReport, useLedgerMutation } from '@/hooks/data';
import { notify } from '@/lib/confirm';
import { closeScreen } from '@/lib/navigation';
import { saveTaxAssumptions, type TaxAssumptionsInput } from '@/services/company';
import { TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Banner, Button, EmptyState, Loading, SectionHeader, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function AssumptionsScreen() {
  const { fy } = useLocalSearchParams<{ fy: string }>();
  const report = useFiscalYearReport(fy);
  if (report.isLoading) return <Loading />;
  if (!report.data) return <EmptyState icon="error" title="Fiscal year not found" />;
  return (
    <AssumptionsForm
      fiscalYearId={report.data.fiscalYear.id}
      label={report.data.fiscalYear.label}
      tvaMode={report.data.company.tvaMode}
      a={report.data.assumptions}
    />
  );
}

const amt = (v: number | null) => (v === null ? '' : minorToInput(v));
const pct = (v: number | null) => (v === null ? '' : bpToInput(v));

type Parsed = { value: number | null; invalid: boolean };
const parseOpt = (s: string, parse: (x: string) => number | null): Parsed => {
  if (!s.trim()) return { value: null, invalid: false };
  const v = parse(s);
  return { value: v, invalid: v === null };
};

function AssumptionsForm({ fiscalYearId, label, tvaMode, a }: { fiscalYearId: string; label: string; tvaMode: TvaMode; a: TaxAssumptions }) {
  const [isRate, setIsRate] = useState(pct(a.isRateBp));
  const [isMinimum, setIsMinimum] = useState(amt(a.isMinimumMinor));
  const [isOverride, setIsOverride] = useState(amt(a.isOverrideMinor));
  const [isOutside, setIsOutside] = useState(a.isPaidOutsideMinor ? amt(a.isPaidOutsideMinor) : '');
  const [withholding, setWithholding] = useState(pct(a.withholdingRateBp));
  const [legal, setLegal] = useState(pct(a.legalReserveRateBp));
  const [tvaCollected, setTvaCollected] = useState(amt(a.tvaCollectedMinor));
  const [tvaDeductible, setTvaDeductible] = useState(amt(a.tvaDeductibleMinor));
  const [preRevenue, setPreRevenue] = useState(amt(a.preTrackingRevenueMinor));
  const [preExpenses, setPreExpenses] = useState(amt(a.preTrackingExpensesMinor));
  const [retained, setRetained] = useState(a.retainedEarningsMinor ? minorToInput(a.retainedEarningsMinor) : '');
  const [source, setSource] = useState(a.sourceNote ?? '');

  // The id travels in the input so the mutation never reads props during render (React Compiler).
  const save = useLedgerMutation((db, v: { id: string; input: TaxAssumptionsInput }) => saveTaxAssumptions(db, v.id, v.input));

  const f = {
    isRate: parseOpt(isRate, parsePercentBp),
    isMinimum: parseOpt(isMinimum, parseAmount),
    isOverride: parseOpt(isOverride, parseAmount),
    isOutside: parseOpt(isOutside, parseAmount),
    withholding: parseOpt(withholding, parsePercentBp),
    legal: parseOpt(legal, parsePercentBp),
    tvaCollected: parseOpt(tvaCollected, parseAmount),
    tvaDeductible: parseOpt(tvaDeductible, parseAmount),
    preRevenue: parseOpt(preRevenue, parseAmount),
    preExpenses: parseOpt(preExpenses, parseAmount),
    retained: parseOpt(retained, parseSignedAmount),
  };
  const invalid = Object.values(f).some((x) => x.invalid);
  const err = (p: Parsed, msg = 'Not a valid amount') => (p.invalid ? msg : null);
  const pctErr = (p: Parsed) => err(p, '0–100, up to 2 decimals');

  const submit = () => {
    if (invalid) {
      notify('Check the highlighted fields');
      return;
    }
    save.mutate(
      {
        id: fiscalYearId,
        input: {
          isRateBp: f.isRate.value,
          isMinimumMinor: f.isMinimum.value,
          isOverrideMinor: f.isOverride.value,
          isPaidOutsideMinor: f.isOutside.value ?? 0,
          withholdingRateBp: f.withholding.value,
          legalReserveRateBp: f.legal.value,
          tvaCollectedMinor: f.tvaCollected.value,
          tvaDeductibleMinor: f.tvaDeductible.value,
          preTrackingRevenueMinor: f.preRevenue.value,
          preTrackingExpensesMinor: f.preExpenses.value,
          retainedEarningsMinor: f.retained.value ?? 0,
          sourceNote: source,
        },
      },
      { onSuccess: () => closeScreen(), onError: (e) => notify('Could not save', e.message) },
    );
  };

  const percent = <Text tone="muted">%</Text>;
  return (
    <>
      <Stack.Screen options={{ title: `Assumptions · ${label}` }} />
      <FormScreen footer={<Button kind="business" label="Save" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />}>
        <Banner tone="info">
          No tax rate is built into the app. Enter the rates that apply to this fiscal year and note where they come from. Leave a field empty
          when you do not know it: the estimate then says what is missing instead of guessing.
        </Banner>

        <SectionHeader title="Corporate tax (IS)" />
        <TextField label="IS rate" hint="One rate applied to the whole taxable profit. If brackets apply, enter the effective rate or the amount below." value={isRate} onChangeText={setIsRate} keyboardType="decimal-pad" trailing={percent} error={pctErr(f.isRate)} />
        <TextField label="Minimum tax (optional)" hint="If the year has a minimum, enter its amount: the estimate uses the higher of the two." value={isMinimum} onChangeText={setIsMinimum} keyboardType="decimal-pad" placeholder="Not entered" error={err(f.isMinimum)} />
        <TextField label="IS amount (optional)" hint="Replaces the calculation, e.g. once your accountant has the figure." value={isOverride} onChangeText={setIsOverride} keyboardType="decimal-pad" placeholder="Calculated" error={err(f.isOverride)} />
        <TextField label="IS paid outside the app" hint="Advances for this year not recorded here. Payments linked to this year's IS obligations are counted automatically." value={isOutside} onChangeText={setIsOutside} keyboardType="decimal-pad" placeholder="0" error={err(f.isOutside)} />

        <SectionHeader title="Distributions" />
        <TextField label="Dividend withholding rate" value={withholding} onChangeText={setWithholding} keyboardType="decimal-pad" trailing={percent} error={pctErr(f.withholding)} />
        <TextField label="Legal reserve rate (optional)" hint="Applied to profit after tax when no legal reserve amount is recorded for this year." value={legal} onChangeText={setLegal} keyboardType="decimal-pad" trailing={percent} error={pctErr(f.legal)} />
        <TextField label="Retained earnings brought forward" hint="Undistributed profit of earlier years (+) or losses still to absorb (−). Earlier years count only through this figure." value={retained} onChangeText={setRetained} keyboardType="numbers-and-punctuation" placeholder="0" error={err(f.retained)} />

        {tvaMode === 'ttc' && (
          <>
            <SectionHeader title="TVA included in recorded amounts" />
            <TextField label="TVA collected on revenue" hint="From your TVA returns for the year. It belongs to the state." value={tvaCollected} onChangeText={setTvaCollected} keyboardType="decimal-pad" placeholder="Not entered" error={err(f.tvaCollected)} />
            <TextField label="Deductible TVA on expenses" value={tvaDeductible} onChangeText={setTvaDeductible} keyboardType="decimal-pad" placeholder="Not entered" error={err(f.tvaDeductible)} />
          </>
        )}

        <SectionHeader title="Before tracking started (HT)" />
        <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
          If a company location was added after the year started, its earlier activity is only in its opening balance. Enter revenue and
          expenses for that part of the year (0 if none).
        </Text>
        <TextField label="Revenue before tracking" value={preRevenue} onChangeText={setPreRevenue} keyboardType="decimal-pad" placeholder="Not entered" error={err(f.preRevenue)} />
        <TextField label="Expenses before tracking" value={preExpenses} onChangeText={setPreExpenses} keyboardType="decimal-pad" placeholder="Not entered" error={err(f.preExpenses)} />

        <SectionHeader title="Source" />
        <TextField label="Where these figures come from" value={source} onChangeText={setSource} placeholder="e.g. Accountant email 12/03, finance law 2026" multiline />
        <View style={{ height: space.xl }} />
      </FormScreen>
    </>
  );
}
