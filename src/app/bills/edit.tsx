import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CategoryPicker, SourcePicker, type Source } from '@/components/entry-pickers';
import { addDays, todayISO } from '@/domain/dates';
import { BASE_CURRENCY, minorToInput, parseAmount } from '@/domain/money';
import { FREQUENCY_PRESETS, type IntervalUnit } from '@/domain/schedule';
import type { AccountWithBalance } from '@/domain/types';
import { useAccountBalances, useCategories, useDebts, useLedgerMutation, useOccurrence, useRule } from '@/hooks/data';
import { confirmAction, notify } from '@/lib/confirm';
import { closeScreen } from '@/lib/navigation';
import type { Debt } from '@/services/debts';
import {
  deleteExpected,
  deleteRule,
  saveExpected,
  saveRule,
  type ExpectedDirection,
  type ExpectedInput,
  type Occurrence,
  type RecurringRule,
  type RuleInput,
} from '@/services/recurring';
import { AmountInput, ChipGroup, DateButton, Field, TextField, Toggle } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Button, Chip, EmptyState, Loading, Segmented, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const FAR = '2100-12-31';
const REMIND = [0, 1, 3, 7, 14];
const UNITS: { unit: IntervalUnit; label: string }[] = [
  { unit: 'day', label: 'days' },
  { unit: 'week', label: 'weeks' },
  { unit: 'month', label: 'months' },
  { unit: 'year', label: 'years' },
];

export default function BillEditScreen() {
  const { id, once, direction } = useLocalSearchParams<{ id?: string; once?: string; direction?: ExpectedDirection }>();
  const isOnce = once === '1';
  const rule = useRule(isOnce ? undefined : id);
  const oneOff = useOccurrence(isOnce && id ? { expectedId: id } : null);
  const accounts = useAccountBalances();
  const debts = useDebts();
  const loading = (id && (isOnce ? oneOff.isLoading : rule.isLoading)) || accounts.isLoading || debts.isLoading;
  if (loading) return <Loading />;
  if (id && !(isOnce ? oneOff.data : rule.data)) return <EmptyState icon="error" title="Not found" message="It may have been deleted." />;
  const personal = (accounts.data ?? []).filter((a) => a.ownership === 'personal');
  if (personal.length === 0) {
    return <EmptyState icon="account_balance_wallet" title="Add a personal money location first" message="Each payment is planned on the location it is paid from or received into." />;
  }
  return (
    <BillForm
      isOnce={isOnce}
      rule={rule.data ?? null}
      oneOff={oneOff.data ?? null}
      accounts={personal}
      debts={(debts.data ?? []).filter((d) => !d.closedAt && d.outstandingMinor > 0)}
      initialDirection={direction ?? 'expense'}
    />
  );
}

function BillForm({
  isOnce,
  rule,
  oneOff,
  accounts,
  debts,
  initialDirection,
}: {
  isOnce: boolean;
  rule: RecurringRule | null;
  oneOff: Occurrence | null;
  accounts: AccountWithBalance[];
  debts: Debt[];
  initialDirection: ExpectedDirection;
}) {
  const c = useColors();
  const existing = rule ?? oneOff;
  const [dir, setDir] = useState<ExpectedDirection>(existing?.direction ?? initialDirection);
  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing ? minorToInput(rule?.amountMinor ?? oneOff!.amountMinor) : '');
  const [source, setSource] = useState<Source | null>(
    existing ? { accountId: existing.accountId, instrumentId: null } : accounts.length === 1 ? { accountId: accounts[0].id, instrumentId: null } : null,
  );
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [payee, setPayee] = useState(rule?.payee ?? '');
  const [unit, setUnit] = useState<IntervalUnit>(rule?.intervalUnit ?? 'month');
  const [count, setCount] = useState(String(rule?.intervalCount ?? 1));
  const [custom, setCustom] = useState(!!rule && !FREQUENCY_PRESETS.some((p) => p.unit === rule.intervalUnit && p.count === rule.intervalCount));
  const [startDate, setStartDate] = useState(rule?.startDate ?? oneOff?.dueDate ?? addDays(todayISO(), 7));
  const [hasEnd, setHasEnd] = useState(!!rule?.endDate);
  const [endDate, setEndDate] = useState(rule?.endDate ?? addDays(todayISO(), 365));
  const [remind, setRemind] = useState(rule?.remindDaysBefore ?? 3);
  const [reserve, setReserve] = useState(existing?.reserve ?? true);
  const [debtId, setDebtId] = useState<string | null>(rule?.debtId ?? null);
  const [notes, setNotes] = useState((rule?.notes ?? oneOff?.notes) ?? '');

  const categories = useCategories(dir).data ?? [];
  const saveR = useLedgerMutation((db, v: { id: string | null; input: RuleInput }) => saveRule(db, v.input, v.id));
  const saveE = useLedgerMutation((db, v: { id: string | null; input: ExpectedInput }) => saveExpected(db, v.input, v.id));
  const removeR = useLedgerMutation((db, ruleId: string) => deleteRule(db, ruleId));
  const removeE = useLedgerMutation((db, expectedId: string) => deleteExpected(db, expectedId));

  const account = accounts.find((a) => a.id === source?.accountId) ?? null;
  const currency = account?.currency ?? BASE_CURRENCY;
  const amountMinor = amount.trim() ? parseAmount(amount, currency) : null;
  const usable = accounts.filter((a) => !a.isArchived && (dir === 'expense' || a.kind !== 'credit_card'));
  const matchingDebts = debts.filter((d) => (d.direction === 'owe') === (dir === 'expense') && (!account || d.currency === account.currency));
  const countNum = Number(count);
  // Null-safe locals: closures must not read through possibly-null objects (React Compiler).
  const sourceId = source?.accountId ?? null;
  const ruleId = rule?.id ?? null;
  const expectedId = oneOff?.expectedId ?? null;

  const submit = () => {
    if (!amountMinor) return notify('Enter the expected amount');
    if (!sourceId) return notify(dir === 'expense' ? 'Choose where it is paid from' : 'Choose where it is received');
    if (!name.trim()) return notify('Give it a name');
    const done = { onSuccess: () => closeScreen(), onError: (e: Error) => notify('Could not save', e.message) };
    if (isOnce) {
      saveE.mutate(
        {
          id: expectedId,
          input: { name, direction: dir, amountMinor, accountId: sourceId, dueDate: startDate, categoryId, reserve, notes },
        },
        done,
      );
      return;
    }
    if (!Number.isInteger(countNum) || countNum < 1) return notify('Enter how often it repeats');
    saveR.mutate(
      {
        id: ruleId,
        input: {
          name,
          direction: dir,
          amountMinor,
          accountId: sourceId,
          categoryId: debtId ? null : categoryId,
          payee,
          debtId,
          intervalUnit: unit,
          intervalCount: countNum,
          startDate,
          endDate: hasEnd ? endDate : null,
          remindDaysBefore: remind,
          reserve,
          notes,
        },
      },
      done,
    );
  };

  const confirmDelete = () => {
    if (ruleId) {
      confirmAction('Delete this recurring payment?', 'Its history of paid and skipped dates goes too. Recorded payments stay. To stop it for a while, pause it instead.', 'Delete', () =>
        removeR.mutate(ruleId, { onSuccess: () => closeScreen(), onError: (e) => notify('Not possible', e.message) }),
      true);
    } else if (expectedId) {
      confirmAction('Delete this expected payment?', 'A payment already recorded for it stays recorded.', 'Delete', () =>
        removeE.mutate(expectedId, { onSuccess: () => closeScreen(), onError: (e) => notify('Not possible', e.message) }),
      true);
    }
  };

  const title = existing ? 'Edit' : isOnce ? 'Expected payment' : 'Recurring payment';
  return (
    <>
      <Stack.Screen options={{ title }} />
      <FormScreen
        footer={
          <>
            {existing && <Button kind="danger" label="Delete" onPress={confirmDelete} />}
            <Button label="Save" icon="check" onPress={submit} loading={saveR.isPending || saveE.isPending} style={{ flex: 1 }} />
          </>
        }>
        <Field>
          <Segmented
            options={[
              { value: 'expense', label: 'Bill / payment' },
              { value: 'income', label: 'Expected income' },
            ]}
            value={dir}
            onChange={(v) => {
              setDir(v);
              setCategoryId(null);
              setDebtId(null);
            }}
          />
        </Field>
        <AmountInput value={amount} onChangeText={setAmount} currency={currency} autoFocus={!existing} tint={dir === 'income' ? c.positive : undefined} accessibilityLabel="Expected amount" />
        <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginBottom: space.lg }}>
          Expected amount. When it varies (electricity), use a typical amount and adjust a single month later.
        </Text>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder={dir === 'income' ? 'e.g. Salary' : isOnce ? 'e.g. Car insurance' : 'e.g. Internet'}
        />
        <SourcePicker label={dir === 'expense' ? 'Paid from' : 'Received into'} accounts={usable} value={source} onChange={setSource} />

        {!isOnce && matchingDebts.length > 0 && (
          <Field
            label={dir === 'expense' ? 'Repays a debt (loan installment)' : 'Repayment of money owed to you'}
            hint="Marking it paid then records a loan repayment (principal, not spending or income), plus interest if any.">
            <ChipGroup>
              <Chip label="No" selected={debtId === null} onPress={() => setDebtId(null)} />
              {matchingDebts.map((d) => (
                <Chip key={d.id} label={d.counterparty} icon="handshake" selected={debtId === d.id} onPress={() => setDebtId(d.id)} />
              ))}
            </ChipGroup>
          </Field>
        )}
        {!debtId && <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />}
        {!isOnce && !debtId && (
          <TextField label={dir === 'expense' ? 'Paid to (optional)' : 'From (optional)'} value={payee} onChangeText={setPayee} placeholder="e.g. Maroc Telecom" />
        )}

        {!isOnce && (
          <Field label="Repeats">
            <ChipGroup>
              {FREQUENCY_PRESETS.map((p) => (
                <Chip
                  key={p.label}
                  label={p.label}
                  selected={!custom && unit === p.unit && countNum === p.count}
                  onPress={() => {
                    setCustom(false);
                    setUnit(p.unit);
                    setCount(String(p.count));
                  }}
                />
              ))}
              <Chip label="Custom" icon="tune" selected={custom} onPress={() => setCustom(true)} />
            </ChipGroup>
            {custom && (
              <View style={{ marginTop: space.md }}>
                <TextField label="Every" value={count} onChangeText={(t) => setCount(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" />
                <ChipGroup>
                  {UNITS.map((u) => (
                    <Chip key={u.unit} label={u.label} selected={unit === u.unit} onPress={() => setUnit(u.unit)} />
                  ))}
                </ChipGroup>
              </View>
            )}
          </Field>
        )}
        <Field label={isOnce ? 'Due date' : 'Next due date'} hint={isOnce ? undefined : 'The first date it is due. Later dates follow the schedule.'}>
          <DateButton value={startDate} onChange={setStartDate} maximumDate={FAR} />
        </Field>
        {!isOnce && (
          <>
            <Toggle label="Ends on a date" value={hasEnd} onChange={setHasEnd} />
            {hasEnd && (
              <View style={{ marginVertical: space.sm }}>
                <DateButton label="Last date" value={endDate} onChange={setEndDate} minimumDate={startDate} maximumDate={FAR} />
              </View>
            )}
            <Field label="Remind me" hint="Shown as due soon on Home and here.">
              <ChipGroup>
                {REMIND.map((d) => (
                  <Chip key={d} label={d === 0 ? 'On the day' : `${d} day${d > 1 ? 's' : ''} before`} selected={remind === d} onPress={() => setRemind(d)} />
                ))}
              </ChipGroup>
            </Field>
          </>
        )}
        {dir === 'expense' && (
          <Toggle
            label="Reserve money for it"
            description="Sets the amount aside in My Money from 30 days before it is due, on the location it is paid from. Nothing moves."
            value={reserve}
            onChange={setReserve}
          />
        )}
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional" />
      </FormScreen>
    </>
  );
}
