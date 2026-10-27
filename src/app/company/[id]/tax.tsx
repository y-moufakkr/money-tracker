import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { EstimateSteps, FigureRow } from '@/components/company';
import { formatDateLabel } from '@/domain/dates';
import { applyBp, formatBp, formatMoney, parsePercentBp, parseSignedAmount } from '@/domain/money';
import type { FiscalYear, TaxItem } from '@/domain/types';
import { useCompany, useFiscalYearReport, useFiscalYears, useLedgerMutation } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import { openTransactions } from '@/lib/drill';
import { currentFiscalYear, deleteTaxItem, saveTaxItem, type TaxItemInput } from '@/services/company';
import { ChipGroup, TextField } from '@/ui/fields';
import { Banner, Button, Card, Chip, Divider, EmptyState, IconButton, ListItem, Loading, Row, SectionHeader, Segmented, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function TaxScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const company = useCompany(id);
  const years = useFiscalYears(id);
  const [picked, setPicked] = useState<string | null>(null);

  if (company.isLoading || years.isLoading) return <Loading />;
  if (!company.data) return <EmptyState icon="error" title="Company not found" />;
  const newYearHref = `/company/fiscal-year?companyId=${company.data.id}` as const;
  const list = years.data ?? [];
  const fy = list.find((y) => y.id === picked) ?? currentFiscalYear(list) ?? list[0] ?? null;

  return (
    <>
      <Stack.Screen options={{ title: 'Tax estimate' }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <ChipGroup>
          {list.map((y) => (
            <Chip key={y.id} label={y.label} selected={y.id === fy?.id} onPress={() => setPicked(y.id)} color={c.business} />
          ))}
          <Chip label="New fiscal year" icon="add" onPress={() => router.push(newYearHref)} />
        </ChipGroup>
        {!fy ? (
          <Card style={{ marginTop: space.lg }}>
            <EmptyState
              icon="calendar_month"
              title="No fiscal year yet"
              message="Create the company's fiscal year to estimate its profit and taxes."
              action={{ label: 'Create fiscal year', onPress: () => router.push(newYearHref) }}
            />
          </Card>
        ) : (
          <YearReport key={fy.id} fy={fy} />
        )}
      </ScrollView>
    </>
  );
}

function YearReport({ fy }: { fy: FiscalYear }) {
  const c = useColors();
  const q = useFiscalYearReport(fy.id);
  if (q.isLoading || !q.data) return <Loading />;
  const r = q.data;
  const a = r.assumptions;
  const remaining = r.estimate.remainingDistributableMinor;

  return (
    <View style={{ marginTop: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          {formatDateLabel(fy.startDate)} – {formatDateLabel(fy.endDate)}
          {r.status.yearToDate ? ' · year to date' : ''}
          {fy.isClosed ? ' · closed' : ''} · amounts {r.company.tvaMode === 'ttc' ? 'recorded TVA included (TTC)' : 'recorded without TVA (HT)'}
        </Text>
        <IconButton icon="edit_calendar" label="Edit fiscal year" onPress={() => router.push(`/company/fiscal-year?companyId=${fy.companyId}&id=${fy.id}`)} />
      </Row>

      {!r.status.complete && (
        <View style={{ marginTop: space.sm }}>
          <Banner tone="warning" title={r.status.hasData ? 'Figures are incomplete' : 'Not enough data yet'}>
            {r.status.reasons.join('\n')}
          </Banner>
        </View>
      )}

      <SectionHeader title="Your assumptions" action={{ label: 'Edit', onPress: () => router.push(`/company/assumptions?fy=${fy.id}`) }} />
      <Card style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label" tone="muted">IS rate</Text>
          <Text variant="label">{a.isOverrideMinor !== null ? `amount ${formatMoney(a.isOverrideMinor)}` : a.isRateBp !== null ? formatBp(a.isRateBp) : 'not entered'}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label" tone="muted">Dividend withholding</Text>
          <Text variant="label">{a.withholdingRateBp !== null ? formatBp(a.withholdingRateBp) : 'not entered'}</Text>
        </Row>
        {r.company.tvaMode === 'ttc' && (
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label" tone="muted">TVA collected / deductible</Text>
            <Text variant="label">
              {a.tvaCollectedMinor !== null ? formatMoney(a.tvaCollectedMinor) : '—'} / {a.tvaDeductibleMinor !== null ? formatMoney(a.tvaDeductibleMinor) : '—'}
            </Text>
          </Row>
        )}
        <Text variant="caption" tone={a.sourceNote ? 'muted' : 'faint'} style={{ marginTop: space.xs }}>
          {a.sourceNote ? `Source: ${a.sourceNote}` : 'No source noted. Rates are never built in: enter the ones that apply to this year and where they come from.'}
        </Text>
        {a.updatedAt && (
          <Text variant="caption" tone="faint">
            Updated {formatDateLabel(a.updatedAt.slice(0, 10))}
          </Text>
        )}
      </Card>

      <SectionHeader title="Step by step" />
      <Text variant="caption" tone="muted" style={{ marginBottom: space.sm }}>
        Tap a step to see how it was obtained. A planning estimate, not a tax return — check it with your accountant.
      </Text>
      <EstimateSteps steps={r.estimate.steps} />
      {r.estimate.missing.length > 0 && (
        <View style={{ marginTop: space.sm }}>
          <Banner tone="warning" title="To complete the estimate">
            <Text variant="label">{r.estimate.missing.map((m) => `• ${m}`).join('\n')}</Text>
            <Button compact kind="ghost" label="Enter assumptions" onPress={() => router.push(`/company/assumptions?fy=${fy.id}`)} />
          </Banner>
        </View>
      )}

      {remaining !== null && (
        <Card tone="estimate" style={{ marginTop: space.md, gap: space.sm }}>
          <Text variant="label" color={c.estimate}>
            Your share of the {formatMoney(remaining)} not yet distributed: {formatMoney(applyBp(remaining, r.company.ownershipBp))} ({formatBp(r.company.ownershipBp)}) before
            withholding — an estimate, not money.
          </Text>
          <Button compact kind="secondary" icon="science" label="Simulate a distribution" onPress={() => router.push(`/company/${fy.companyId}/simulate?fy=${fy.id}`)} />
        </Card>
      )}

      <SectionHeader title="Adjustments & other taxes" />
      <TaxItems fiscalYearId={fy.id} items={r.items} />

      {r.pnl.excluded.length > 0 && (
        <>
          <SectionHeader title="Not counted as revenue or expenses" />
          <Card padded={false}>
            {r.pnl.excluded.map((g, i) => (
              <View key={g.key}>
                {i > 0 && <Divider inset={space.lg} />}
                <ListItem
                  title={g.label}
                  subtitle={`${g.reason} · ${g.count}×`}
                  right={<Text variant="label">{formatMoney(g.amountMinor)}</Text>}
                  onPress={() => openTransactions(g.drill, g.label)}
                  chevron
                />
              </View>
            ))}
          </Card>
        </>
      )}
      {r.pnl.expenseTransfers.groups.length > 0 && (
        <Card style={{ marginTop: space.sm, paddingVertical: space.sm }}>
          {r.pnl.expenseTransfers.groups.map((g) => (
            <FigureRow key={g.key} label={g.label} minor={g.amountMinor} hint={`${g.reason} · ${g.count}×`} onPress={() => openTransactions(g.drill, g.label)} />
          ))}
        </Card>
      )}
      {r.pnl.adjustments.count > 0 && (
        <View style={{ marginTop: space.sm }}>
          <Banner tone="info" title="Balance adjustments (not counted)">
            {`${formatMoney(r.pnl.adjustments.totalMinor, 'MAD', { sign: 'always' })} from ${r.pnl.adjustments.count} balance check(s): unexplained differences, not revenue or expenses.`}
          </Banner>
        </View>
      )}
    </View>
  );
}

function TaxItems({ fiscalYearId, items }: { fiscalYearId: string; items: TaxItem[] }) {
  const c = useColors();
  const [kind, setKind] = useState<'adjustment' | 'other_tax'>('adjustment');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [base, setBase] = useState<'revenue' | 'taxable_profit'>('taxable_profit');
  const [source, setSource] = useState('');
  const save = useLedgerMutation((db, input: TaxItemInput) => saveTaxItem(db, input));
  const remove = useLedgerMutation((db, itemId: string) => deleteTaxItem(db, itemId));

  const amountMinor = amount.trim() ? parseSignedAmount(amount) : null;
  const rateBp = rate.trim() ? parsePercentBp(rate) : null;

  const submit = () => {
    const useRate = kind === 'other_tax' && !amount.trim();
    if (!label.trim() || (useRate ? rateBp === null : amountMinor === null)) {
      notify('Check the item', kind === 'adjustment' ? 'Enter a description and an amount (negative for a deduction).' : 'Enter a description and either an amount or a rate.');
      return;
    }
    save.mutate(
      {
        fiscalYearId,
        kind,
        label,
        amountMinor: useRate ? null : amountMinor,
        rateBp: useRate ? rateBp : null,
        base: useRate ? base : null,
        sourceNote: source,
      },
      {
        onSuccess: () => {
          setLabel('');
          setAmount('');
          setRate('');
          setSource('');
        },
        onError: (e) => notify('Could not save', e.message),
      },
    );
  };

  return (
    <Card>
      {items.length === 0 ? (
        <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
          None. Add non-deductible expenses (+), extra deductions (−), or other taxes for the year.
        </Text>
      ) : (
        items.map((i) => (
          <Row key={i.id} style={{ paddingVertical: space.xs }}>
            <View style={{ flex: 1 }}>
              <Text variant="label">{i.label}</Text>
              <Text variant="caption" tone="muted">
                {i.kind === 'adjustment' ? 'Taxable-profit adjustment' : 'Other tax'}
                {i.sourceNote ? ` · ${i.sourceNote}` : ''}
              </Text>
            </View>
            <Text variant="label">
              {i.rateBp !== null ? `${formatBp(i.rateBp)} of ${i.base === 'revenue' ? 'revenue' : 'taxable profit'}` : formatMoney(i.amountMinor ?? 0, 'MAD', { sign: i.kind === 'adjustment' ? 'always' : 'auto' })}
            </Text>
            <IconButton
              icon="delete"
              label={`Remove ${i.label}`}
              size={20}
              color={c.textMuted}
              onPress={() => confirmAction('Remove this item?', i.label, 'Remove', () => remove.mutate(i.id), true)}
            />
          </Row>
        ))
      )}
      <Divider />
      <View style={{ marginTop: space.md }}>
        <Segmented
          options={[
            { value: 'adjustment', label: 'Adjustment' },
            { value: 'other_tax', label: 'Other tax' },
          ]}
          value={kind}
          onChange={setKind}
          tint={c.business}
        />
        <View style={{ height: space.md }} />
        <TextField label="Description" value={label} onChangeText={setLabel} placeholder={kind === 'adjustment' ? 'e.g. Non-deductible fines' : 'e.g. Professional tax'} />
        <TextField
          label={kind === 'adjustment' ? 'Amount (+ adds to taxable profit, − deducts)' : 'Amount'}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numbers-and-punctuation"
          placeholder="0"
          error={amount.trim() && amountMinor === null ? 'Not a valid amount' : null}
        />
        {kind === 'other_tax' && !amount.trim() && (
          <>
            <TextField label="…or a rate" value={rate} onChangeText={setRate} keyboardType="decimal-pad" trailing={<Text tone="muted">%</Text>} error={rate.trim() && rateBp === null ? '0–100, up to 2 decimals' : null} />
            <ChipGroup>
              <Chip label="of taxable profit" selected={base === 'taxable_profit'} onPress={() => setBase('taxable_profit')} color={c.business} />
              <Chip label="of revenue (HT)" selected={base === 'revenue'} onPress={() => setBase('revenue')} color={c.business} />
            </ChipGroup>
            <View style={{ height: space.md }} />
          </>
        )}
        <TextField label="Source (optional)" value={source} onChangeText={setSource} placeholder="e.g. Accountant, 2026 finance law" />
        <Button compact kind="business" icon="add" label="Add item" onPress={submit} loading={save.isPending} />
      </View>
    </Card>
  );
}
