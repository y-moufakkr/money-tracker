import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { addDays, addMonths, isValidISODate } from '@/domain/dates';
import type { Company, FiscalYear } from '@/domain/types';
import { useCompany, useFiscalYears, useLedgerMutation } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import { closeScreen } from '@/lib/navigation';
import { deleteFiscalYear, fiscalYearBounds, saveFiscalYear, type FiscalYearInput } from '@/services/company';
import { DateButton, Field, TextField, Toggle } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Button, EmptyState, Loading, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

const FAR = '2100-12-31';

export default function FiscalYearScreen() {
  const { companyId, id } = useLocalSearchParams<{ companyId: string; id?: string }>();
  const company = useCompany(companyId);
  const years = useFiscalYears(companyId);
  if (company.isLoading || years.isLoading) return <Loading />;
  if (!company.data) return <EmptyState icon="error" title="Company not found" />;
  const existing = id ? (years.data ?? []).find((y) => y.id === id) : undefined;
  if (id && !existing) return <EmptyState icon="error" title="Fiscal year not found" />;
  return <FiscalYearForm company={company.data} existing={existing ?? null} years={years.data ?? []} />;
}

/** The year after the latest one, or the one containing today. */
function suggestion(company: Company, years: FiscalYear[]) {
  const latest = years[0];
  if (!latest) return fiscalYearBounds(company.fiscalYearStartMonth);
  const startDate = addDays(latest.endDate, 1);
  return fiscalYearBounds(Number(startDate.slice(5, 7)), startDate);
}

function FiscalYearForm({ company, existing, years }: { company: Company; existing: FiscalYear | null; years: FiscalYear[] }) {
  const s = suggestion(company, years);
  const [label, setLabel] = useState(existing?.label ?? s.label);
  const [startDate, setStart] = useState(existing?.startDate ?? s.startDate);
  const [endDate, setEnd] = useState(existing?.endDate ?? s.endDate);
  const [closed, setClosed] = useState(existing?.isClosed ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const save = useLedgerMutation((db, v: { id: string | null; input: FiscalYearInput }) => saveFiscalYear(db, v.input, v.id));
  const remove = useLedgerMutation((db, fyId: string) => deleteFiscalYear(db, fyId));

  const submit = () => {
    if (!isValidISODate(startDate) || !isValidISODate(endDate)) {
      notify('Check the dates');
      return;
    }
    save.mutate(
      { id: existing?.id ?? null, input: { companyId: company.id, label, startDate, endDate, isClosed: closed, notes } },
      { onSuccess: () => closeScreen(), onError: (e) => notify('Could not save', e.message) },
    );
  };

  const existingId = existing?.id ?? null;
  return (
    <>
      <Stack.Screen options={{ title: existing ? `Fiscal year ${existing.label}` : 'New fiscal year' }} />
      <FormScreen
        footer={
          <>
            {existingId && (
              <Button
                kind="danger"
                label="Delete"
                onPress={() =>
                  confirmAction('Delete this fiscal year?', 'Its assumptions and adjustments are deleted. Transactions are not affected.', 'Delete', () =>
                    remove.mutate(existingId, { onSuccess: () => closeScreen(), onError: (e) => notify('Not possible', e.message) }),
                  true)
                }
              />
            )}
            <Button kind="business" label="Save" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />
          </>
        }>
        <TextField label="Name" value={label} onChangeText={setLabel} placeholder="e.g. 2026" />
        <Field label="Dates" hint="Usually 12 months. The first year of a company can be shorter or longer.">
          <View style={{ gap: space.sm }}>
            <DateButton label="Starts" value={startDate} maximumDate={FAR} onChange={(v) => {
              setStart(v);
              setEnd(addDays(addMonths(v, 12), -1));
            }} />
            <DateButton label="Ends" value={endDate} minimumDate={startDate} maximumDate={FAR} onChange={setEnd} />
          </View>
        </Field>
        <Toggle label="Closed" description="The accounts for this year are final." value={closed} onChange={setClosed} />
        <View style={{ height: space.md }} />
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional" />
        <Text variant="caption" tone="muted">
          Revenue and expenses are read from the transactions dated within these dates.
        </Text>
      </FormScreen>
    </>
  );
}
