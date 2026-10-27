import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { categoriesFor, CategoryPicker, MerchantField, SourcePicker, type Source } from '@/components/entry-pickers';
import { todayISO } from '@/domain/dates';
import { BASE_CURRENCY, minorToInput, parseAmount } from '@/domain/money';
import type { AccountWithBalance, Category } from '@/domain/types';
import { useAccountBalances, useCategories, useLedgerMutation, useSetting, useTransaction } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { saveIncome, type IncomeInput } from '@/services/ledger';
import { SETTING, setSetting } from '@/services/queries';
import { AmountInput, DateField, TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Banner, Button, EmptyState, Loading } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

type Initial = { amount: string; source: string; categoryId: string | null; dest: Source | null; date: string; note: string };

export default function IncomeScreen() {
  const params = useLocalSearchParams<{ id?: string; account?: string }>();
  const editing = useTransaction(params.id);
  const allAccounts = useAccountBalances().data;
  const categories = useCategories('income').data;
  const lastAccount = useSetting(SETTING.lastIncomeAccount);

  if (!allAccounts || !categories || lastAccount.isLoading || (params.id && editing.isLoading)) return <Loading />;
  if (params.id && !editing.data) return <EmptyState icon="error" title="Transaction not found" />;
  const accounts = allAccounts.filter((a) => a.kind !== 'credit_card');
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon="account_balance_wallet"
        title="Add a money location first"
        message="Income always lands somewhere: a bank account, your wallet…"
        action={{ label: 'Add location', onPress: () => router.replace('/accounts/new') }}
      />
    );
  }

  const t = editing.data;
  let initial: Initial;
  if (t) {
    initial = {
      amount: minorToInput(t.amountMinor, t.currency),
      source: t.merchantName ?? '',
      categoryId: t.categoryId,
      dest: t.roles.main ? { accountId: t.roles.main.id, instrumentId: null } : null,
      date: t.date,
      note: t.note ?? '',
    };
  } else {
    const preferred = [params.account, lastAccount.data].find((x) => x && accounts.some((a) => a.id === x));
    const fallback = accounts.find((a) => a.ownership === 'personal' && a.kind === 'bank') ?? accounts[0];
    initial = {
      amount: '',
      source: '',
      categoryId: null,
      dest: { accountId: preferred ?? fallback.id, instrumentId: null },
      date: todayISO(),
      note: '',
    };
  }
  return <IncomeForm id={params.id ?? null} initial={initial} accounts={accounts} categories={categories} />;
}

function IncomeForm({
  id,
  initial,
  accounts,
  categories,
}: {
  id: string | null;
  initial: Initial;
  accounts: AccountWithBalance[];
  categories: Category[];
}) {
  const c = useColors();
  const [amount, setAmount] = useState(initial.amount);
  const [source, setSource] = useState(initial.source);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [dest, setDest] = useState(initial.dest);
  const [destTouched, setDestTouched] = useState(!!id);
  const [date, setDate] = useState(initial.date);
  const [note, setNote] = useState(initial.note);

  const save = useLedgerMutation(async (db, input: IncomeInput) => {
    const txId = await saveIncome(db, input, id);
    await setSetting(db, SETTING.lastIncomeAccount, input.accountId);
    return txId;
  });

  const destId = dest?.accountId ?? null;
  const account = accounts.find((a) => a.id === destId);
  const currency = account?.currency ?? BASE_CURRENCY;
  const amountMinor = amount.trim() ? parseAmount(amount, currency) : null;

  const submit = () => {
    if (amountMinor === null || amountMinor <= 0) return Alert.alert('Enter an amount', 'How much did you receive?');
    if (!dest) return Alert.alert('Where did it arrive?', 'Choose the receiving location.');
    save.mutate(
      { date, amountMinor, accountId: dest.accountId, categoryId, merchantName: source, note },
      { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Could not save', e.message) },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: id ? 'Edit income' : 'Income' }} />
      <FormScreen footer={<Button label="Save income" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />}>
        <AmountInput value={amount} onChangeText={setAmount} currency={currency} autoFocus={!id} tint={c.positive} />
        <MerchantField
          label="From (optional)"
          placeholder="e.g. Employer, client name"
          value={source}
          kind="income"
          onChange={setSource}
          onPick={(m) => {
            setSource(m.name);
            if (!categoryId && m.defaultCategoryId) setCategoryId(m.defaultCategoryId);
            if (m.last && !destTouched && accounts.some((a) => a.id === m.last!.accountId)) setDest({ accountId: m.last.accountId, instrumentId: null });
          }}
        />
        <SourcePicker
          label="Received into"
          accounts={accounts}
          value={dest}
          onChange={(d) => {
            setDest(d);
            setDestTouched(true);
          }}
        />
        <CategoryPicker categories={categoriesFor(categories, account?.ownership)} value={categoryId} onChange={setCategoryId} />
        {account?.ownership === 'business' && (
          <Banner tone="info" title="Company income">
            This is recorded as company revenue, not personal income. Money the company pays you should be a classified Transfer.
          </Banner>
        )}
        <DateField value={date} onChange={setDate} />
        <TextField label="Note (optional)" value={note} onChangeText={setNote} multiline />
        <Banner tone="info">
          Moving your own money between locations (e.g. withdrawing cash) is a Transfer, not income.
        </Banner>
        <Button kind="ghost" icon="swap_horiz" label="Record a transfer instead" onPress={() => router.replace('/entry/transfer')} style={{ marginTop: space.sm }} />
      </FormScreen>
    </>
  );
}
