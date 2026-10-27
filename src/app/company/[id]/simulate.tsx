import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { PayoutResult } from '@/components/company';
import { formatDateLabel } from '@/domain/dates';
import { bpToInput, formatBp, formatMoney, minorToInput, parseAmount, parsePercentBp } from '@/domain/money';
import type { DistributionSimulation } from '@/domain/types';
import { useCompanyDashboard, useFiscalYearReport, useLedgerMutation } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import { deleteSimulation, saveSimulation, simulateDistribution } from '@/services/distributions';
import type { CompanyDashboard } from '@/services/overview';
import { ChipGroup, TextField } from '@/ui/fields';
import { Banner, Button, Card, Chip, Divider, EmptyState, IconButton, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function SimulateScreen() {
  const { id, fy } = useLocalSearchParams<{ id: string; fy?: string }>();
  const dash = useCompanyDashboard(id);
  if (dash.isLoading) return <Loading />;
  if (!dash.data) return <EmptyState icon="error" title="Company not found" />;
  return <Simulator d={dash.data} initialFy={fy ?? dash.data.fiscalYear?.id ?? null} />;
}

type SimInput = Parameters<typeof saveSimulation>[1];

function Simulator({ d, initialFy }: { d: CompanyDashboard; initialFy: string | null }) {
  const c = useColors();
  const [fyId, setFyId] = useState<string | null>(initialFy);
  const report = useFiscalYearReport(fyId ?? undefined);
  const r = report.data;
  const estimateDistributable = r?.status.complete ? r.estimate.remainingDistributableMinor : null;
  const withholdingDefault = r?.assumptions.withholdingRateBp ?? null;

  // Empty fields fall back to the estimate / company / assumptions, so the defaults follow the chosen year.
  const [distributable, setDistributable] = useState('');
  const [ownership, setOwnership] = useState(bpToInput(d.company.ownershipBp));
  const [withholding, setWithholding] = useState('');
  const [proposed, setProposed] = useState('');
  const [name, setName] = useState('');
  // The saved simulation an approval comes from; cleared when an input changes.
  const [savedId, setSavedId] = useState<string | null>(null);
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setSavedId(null);
  };
  const save = useLedgerMutation((db, input: SimInput) => saveSimulation(db, input));
  const remove = useLedgerMutation((db, simId: string) => deleteSimulation(db, simId));

  const distributableMinor = distributable.trim() ? parseAmount(distributable) : estimateDistributable;
  const ownershipBp = parsePercentBp(ownership);
  const withholdingBp = withholding.trim() ? parsePercentBp(withholding) : withholdingDefault;
  const proposedMinor = proposed.trim() ? parseAmount(proposed) : null;
  const ready = distributableMinor !== null && ownershipBp !== null && withholdingBp !== null && proposedMinor !== null && proposedMinor > 0;
  const result = ready
    ? simulateDistribution({ distributableMinor, ownershipBp, withholdingBp, proposedMinor, liquidityMinor: d.position.liquidityMinor })
    : null;

  const load = (s: DistributionSimulation) => {
    setFyId(s.fiscalYearId);
    setDistributable(minorToInput(s.distributableMinor));
    setOwnership(bpToInput(s.ownershipBp));
    setWithholding(bpToInput(s.withholdingBp));
    setProposed(minorToInput(s.proposedMinor));
    setName(s.name ?? '');
    setSavedId(s.id);
  };

  const companyId = d.company.id;
  const submit = () => {
    if (!ready) return;
    save.mutate(
      { companyId, fiscalYearId: fyId, name, distributableMinor, ownershipBp, withholdingBp, proposedMinor },
      {
        onSuccess: (simId) => {
          setSavedId(simId);
          notify('Simulation saved', 'It is stored separately and does not change any balance.');
        },
        onError: (e) => notify('Could not save', e.message),
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Distribution simulator' }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <Banner tone="estimate" title="A calculation, not a decision">
          Nothing here changes a balance or a total. Money reaches you only through a real company → personal dividend transfer.
        </Banner>

        {d.fiscalYears.length > 0 && (
          <>
            <SectionHeader title="Out of the profit of" />
            <ChipGroup>
              {d.fiscalYears.map((y) => (
                <Chip key={y.id} label={y.label} selected={fyId === y.id} onPress={() => setFyId(y.id)} color={c.business} />
              ))}
            </ChipGroup>
          </>
        )}

        <SectionHeader title="Inputs" />
        <Card>
          <TextField
            label="Estimated distributable profit"
            hint={
              estimateDistributable !== null
                ? `From the tax estimate: ${formatMoney(estimateDistributable)} not yet distributed. Leave empty to use it.`
                : r && !r.status.complete
                  ? 'The estimate needs complete figures for this year — enter your own figure.'
                  : 'Enter the figure, e.g. from your accountant.'
            }
            value={distributable}
            onChangeText={edit(setDistributable)}
            keyboardType="decimal-pad"
            placeholder={estimateDistributable !== null ? minorToInput(estimateDistributable) : 'e.g. 60000'}
            error={distributable.trim() && parseAmount(distributable) === null ? 'Not a valid amount' : null}
          />
          <TextField
            label="Your ownership"
            hint={`${formatBp(d.company.ownershipBp)} in the company settings. A share of what is distributed, not of company cash.`}
            value={ownership}
            onChangeText={edit(setOwnership)}
            keyboardType="decimal-pad"
            trailing={<Text tone="muted">%</Text>}
            error={ownershipBp === null ? '0–100, up to 2 decimals' : null}
          />
          <TextField
            label="Withholding rate"
            hint={withholdingDefault !== null ? `From this year's assumptions: ${formatBp(withholdingDefault)}. Leave empty to use it.` : 'Enter the rate that applies (not built in).'}
            value={withholding}
            onChangeText={edit(setWithholding)}
            keyboardType="decimal-pad"
            placeholder={withholdingDefault !== null ? bpToInput(withholdingDefault) : 'e.g. 12.5'}
            trailing={<Text tone="muted">%</Text>}
            error={withholding.trim() && parsePercentBp(withholding) === null ? '0–100, up to 2 decimals' : null}
          />
          <TextField
            label="Proposed distribution (all partners)"
            value={proposed}
            onChangeText={edit(setProposed)}
            keyboardType="decimal-pad"
            placeholder="e.g. 40000"
            error={proposed.trim() && proposedMinor === null ? 'Not a valid amount' : null}
          />
          <Text variant="caption" tone="muted">
            Company liquidity after obligations: {formatMoney(d.position.liquidityMinor)}.
          </Text>
        </Card>

        <SectionHeader title="Result" />
        {!result ? (
          <Card>
            <Text tone="muted">
              {distributableMinor === null
                ? 'Enter the distributable profit.'
                : withholdingBp === null
                  ? 'Enter the withholding rate.'
                  : 'Enter the proposed distribution.'}
            </Text>
          </Card>
        ) : (
          <PayoutResult netMinor={result.netMinor} grossMinor={result.ownerGrossMinor} withholdingMinor={result.withholdingMinor}>
            <Divider />
            {result.calculation.map((line) => (
              <Text key={line} variant="caption" tone="muted">
                {line}
              </Text>
            ))}
            {result.othersMinor > 0 && (
              <Text variant="caption" tone="muted">
                Other partners: {formatMoney(result.othersMinor)} gross.
              </Text>
            )}
          </PayoutResult>
        )}
        {result?.warnings.map((w) => (
          <View key={w} style={{ marginTop: space.sm }}>
            <Banner tone="warning">{w}</Banner>
          </View>
        ))}

        {result && (
          <Card style={{ marginTop: space.md }}>
            <TextField label="Name (optional)" value={name} onChangeText={setName} placeholder="e.g. Summer payout" />
            <Row>
              <Button kind="secondary" icon="bookmark_add" label="Save simulation" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />
              <Button
                kind="business"
                icon="gavel"
                label="Record approval"
                style={{ flex: 1 }}
                onPress={() =>
                  router.push({
                    pathname: '/company/approve',
                    params: {
                      companyId,
                      fy: fyId ?? '',
                      total: String(proposedMinor),
                      own: String(ownershipBp),
                      wh: String(withholdingBp),
                      sim: savedId ?? '',
                    },
                  })
                }
              />
            </Row>
          </Card>
        )}

        <SectionHeader title={`Saved simulations (${d.simulations.length})`} />
        <Card padded={false}>
          {d.simulations.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text tone="muted">None saved.</Text>
            </View>
          ) : (
            d.simulations.map((s, i) => (
              <View key={s.id}>
                {i > 0 && <Divider inset={space.lg} />}
                <Row style={{ paddingRight: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <ListItem
                      title={s.name ?? `${formatMoney(s.proposedMinor)} proposed`}
                      subtitle={`${formatDateLabel(s.createdAt.slice(0, 10))} · ${formatBp(s.ownershipBp)} · ${formatBp(s.withholdingBp)} withholding · net ${formatMoney(s.netMinor)} (estimate)`}
                      onPress={() => load(s)}
                    />
                  </View>
                  <IconButton
                    icon="delete"
                    label="Delete simulation"
                    color={c.textMuted}
                    onPress={() => confirmAction('Delete this simulation?', 'It is only a calculation; nothing else changes.', 'Delete', () => remove.mutate(s.id), true)}
                  />
                </Row>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </>
  );
}
