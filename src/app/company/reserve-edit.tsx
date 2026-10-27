import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { BASE_CURRENCY, minorToInput, parseAmount } from '@/domain/money';
import { RESERVE_KINDS, type CompanyReserve, type FiscalYear, type ReserveKind } from '@/domain/types';
import { useFiscalYears, useLedgerMutation, useReserves } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import { closeScreen } from '@/lib/navigation';
import { deleteReserve, saveReserve, type ReserveInput } from '@/services/company';
import { AmountInput, ChipGroup, Field, TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Button, Chip, EmptyState, Loading, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function ReserveEditScreen() {
  const { companyId, id } = useLocalSearchParams<{ companyId: string; id?: string }>();
  const reserves = useReserves(companyId);
  const years = useFiscalYears(companyId);
  if (reserves.isLoading || years.isLoading) return <Loading />;
  const existing = id ? (reserves.data ?? []).find((r) => r.id === id) : undefined;
  if (id && !existing) return <EmptyState icon="error" title="Reserve not found" />;
  return <ReserveForm companyId={companyId} existing={existing ?? null} years={years.data ?? []} />;
}

function ReserveForm({ companyId, existing, years }: { companyId: string; existing: CompanyReserve | null; years: FiscalYear[] }) {
  const c = useColors();
  const [kind, setKind] = useState<ReserveKind>(existing?.kind ?? 'cash');
  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing ? minorToInput(existing.amountMinor) : '');
  const [fyId, setFyId] = useState<string | null>(existing?.fiscalYearId ?? years[0]?.id ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const save = useLedgerMutation((db, v: { id: string | null; input: ReserveInput }) => saveReserve(db, v.input, v.id));
  const remove = useLedgerMutation((db, reserveId: string) => deleteReserve(db, reserveId));
  const amountMinor = amount.trim() ? parseAmount(amount) : null;

  const submit = () => {
    if (!amountMinor) {
      notify('Enter the amount');
      return;
    }
    save.mutate(
      { id: existing?.id ?? null, input: { companyId, kind, name, amountMinor, fiscalYearId: kind === 'cash' ? null : fyId, notes } },
      { onSuccess: () => closeScreen(), onError: (e) => notify('Could not save', e.message) },
    );
  };

  const existingId = existing?.id ?? null;
  const hint = RESERVE_KINDS.find((k) => k.kind === kind)?.hint;
  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Edit reserve' : 'New reserve' }} />
      <FormScreen
        footer={
          <>
            {existingId && (
              <Button
                kind="danger"
                label="Delete"
                onPress={() =>
                  confirmAction('Delete this reserve?', 'No money moves.', 'Delete', () =>
                    remove.mutate(existingId, { onSuccess: () => closeScreen(), onError: (e) => notify('Not possible', e.message) }),
                  true)
                }
              />
            )}
            <Button kind="business" label="Save" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />
          </>
        }>
        <AmountInput value={amount} onChangeText={setAmount} currency={BASE_CURRENCY} autoFocus={!existing} tint={c.business} accessibilityLabel="Reserve amount" />
        <Field label="Kind" hint={hint}>
          <ChipGroup>
            {RESERVE_KINDS.map((k) => (
              <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} color={c.business} />
            ))}
          </ChipGroup>
        </Field>
        <TextField label="Name" value={name} onChangeText={setName} placeholder={kind === 'cash' ? 'e.g. 3 months of runway' : 'e.g. Legal reserve 2026'} />
        {kind !== 'cash' &&
          (years.length === 0 ? (
            <Text variant="caption" color={c.warning} style={{ marginBottom: space.md }}>
              Create a fiscal year first: a profit reserve comes out of one year’s profit.
            </Text>
          ) : (
            <Field label="Out of the profit of">
              <ChipGroup>
                {years.map((y) => (
                  <Chip key={y.id} label={y.label} selected={fyId === y.id} onPress={() => setFyId(y.id)} color={c.business} />
                ))}
              </ChipGroup>
            </Field>
          ))}
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional" />
        <Text variant="caption" tone="muted">
          A reserve never moves money. It only limits what counts as available (cash) or distributable (profit).
        </Text>
      </FormScreen>
    </>
  );
}
