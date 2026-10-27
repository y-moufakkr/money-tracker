import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { addMonths, todayISO } from '@/domain/dates';
import { BASE_CURRENCY, minorToInput, parseAmount } from '@/domain/money';
import { LIABILITY_KINDS, type FiscalYear, type LiabilityKind } from '@/domain/types';
import { useFiscalYears, useLedgerMutation, useLiability } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import { closeScreen } from '@/lib/navigation';
import { deleteLiability, saveLiability, type Liability, type LiabilityInput } from '@/services/obligations';
import { AmountInput, ChipGroup, DateButton, Field, TextField, Toggle } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Button, Chip, EmptyState, Loading } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const FAR = '2100-12-31';

export default function ObligationEditScreen() {
  const { companyId, id, kind } = useLocalSearchParams<{ companyId: string; id?: string; kind?: LiabilityKind }>();
  const existing = useLiability(id);
  const years = useFiscalYears(companyId);
  if ((id && existing.isLoading) || years.isLoading) return <Loading />;
  if (id && !existing.data) return <EmptyState icon="error" title="Obligation not found" />;
  return <ObligationForm companyId={companyId} existing={existing.data ?? null} years={years.data ?? []} initialKind={kind ?? 'is'} />;
}

const LABELS: Record<LiabilityKind, string> = {
  is: 'IS advance',
  tva: 'TVA return',
  payroll: 'Salaries',
  cnss: 'CNSS',
  supplier: 'Supplier invoice',
  withholding: 'Dividend withholding',
  dividend: 'Dividends to partners',
  other: '',
};

function ObligationForm({
  companyId,
  existing,
  years,
  initialKind,
}: {
  companyId: string;
  existing: Liability | null;
  years: FiscalYear[];
  initialKind: LiabilityKind;
}) {
  const c = useColors();
  const [kind, setKind] = useState<LiabilityKind>(existing?.kind ?? initialKind);
  const [label, setLabel] = useState(existing?.label ?? LABELS[initialKind]);
  const [amount, setAmount] = useState(existing ? minorToInput(existing.amountMinor) : '');
  const [hasDue, setHasDue] = useState(existing ? existing.dueDate !== null : true);
  const [due, setDue] = useState(existing?.dueDate ?? addMonths(todayISO(), 1));
  const [fyId, setFyId] = useState<string | null>(existing?.fiscalYearId ?? years[0]?.id ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const save = useLedgerMutation((db, v: { id: string | null; input: LiabilityInput }) => saveLiability(db, v.input, v.id));
  const remove = useLedgerMutation((db, liabilityId: string) => deleteLiability(db, liabilityId));
  const amountMinor = amount.trim() ? parseAmount(amount) : null;

  const submit = () => {
    if (!amountMinor) {
      notify('Enter the amount owed');
      return;
    }
    save.mutate(
      {
        id: existing?.id ?? null,
        input: { companyId, kind, label, amountMinor, dueDate: hasDue ? due : null, fiscalYearId: fyId, notes },
      },
      { onSuccess: () => closeScreen(), onError: (e) => notify('Could not save', e.message) },
    );
  };

  const existingId = existing?.id ?? null;
  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Edit obligation' : 'New obligation' }} />
      <FormScreen
        footer={
          <>
            {existingId && (
              <Button
                kind="danger"
                label="Delete"
                onPress={() =>
                  confirmAction('Delete this obligation?', 'Linked payments are unlinked; the payments themselves stay recorded.', 'Delete', () =>
                    remove.mutate(existingId, { onSuccess: () => closeScreen(), onError: (e) => notify('Not possible', e.message) }),
                  true)
                }
              />
            )}
            <Button kind="business" label="Save" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />
          </>
        }>
        <AmountInput value={amount} onChangeText={setAmount} currency={BASE_CURRENCY} autoFocus={!existing} tint={c.business} accessibilityLabel="Amount owed" />
        <Field label="Kind">
          <ChipGroup>
            {LIABILITY_KINDS.map((k) => (
              <Chip
                key={k.kind}
                label={k.label}
                icon={k.icon}
                selected={kind === k.kind}
                color={c.business}
                onPress={() => {
                  if (!label.trim() || label === LABELS[kind]) setLabel(LABELS[k.kind]);
                  setKind(k.kind);
                }}
              />
            ))}
          </ChipGroup>
        </Field>
        <TextField label="Description" value={label} onChangeText={setLabel} placeholder="e.g. IS advance Q1 2026" />
        <Toggle label="Has a due date" value={hasDue} onChange={setHasDue} />
        {hasDue && (
          <View style={{ marginVertical: space.sm }}>
            <DateButton label="Due" value={due} maximumDate={FAR} onChange={setDue} />
          </View>
        )}
        {years.length > 0 && (
          <Field label="Fiscal year" hint="IS obligations of a year count as that year's tax advances once paid.">
            <ChipGroup>
              <Chip label="None" selected={fyId === null} onPress={() => setFyId(null)} color={c.business} />
              {years.map((y) => (
                <Chip key={y.id} label={y.label} selected={fyId === y.id} onPress={() => setFyId(y.id)} color={c.business} />
              ))}
            </ChipGroup>
          </Field>
        )}
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional" />
      </FormScreen>
    </>
  );
}
