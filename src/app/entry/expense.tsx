import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { CategoryPicker, decodeSource, encodeSource, MerchantField, SourcePicker, type Source } from '@/components/entry-pickers';
import { draftFromItem, ItemsEditor, parseDraft, type ItemDraft } from '@/components/items-editor';
import { TagPicker } from '@/components/tag-picker';
import { todayISO } from '@/domain/dates';
import { BASE_CURRENCY, minorToInput, parseAmount } from '@/domain/money';
import type { AccountWithBalance, Category, PaymentInstrument } from '@/domain/types';
import { useAccountBalances, useCategories, useInstruments, useLedgerMutation, useSetting, useTransaction } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { saveExpense, type ExpenseInput } from '@/services/ledger';
import { SETTING, setSetting } from '@/services/queries';
import { AmountInput, DateField, TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Button, EmptyState, Loading, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

type Initial = {
  amount: string;
  merchant: string;
  categoryId: string | null;
  source: Source | null;
  date: string;
  note: string;
  items: ItemDraft[];
  tagIds: string[];
};

/** Loads everything the form needs, then mounts the form with its initial values. */
export default function ExpenseScreen() {
  const params = useLocalSearchParams<{ id?: string; account?: string }>();
  const editing = useTransaction(params.id);
  const accounts = useAccountBalances().data;
  const cards = useInstruments().data;
  const categories = useCategories('expense').data;
  const lastSource = useSetting(SETTING.lastExpenseSource);

  if (!accounts || !cards || !categories || lastSource.isLoading || (params.id && editing.isLoading)) return <Loading />;
  if (params.id && !editing.data) return <EmptyState icon="error" title="Transaction not found" />;
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon="account_balance_wallet"
        title="Add a money location first"
        message="Every expense comes out of a place: your wallet, a bank account, a card…"
        action={{ label: 'Add location', onPress: () => router.replace('/accounts/new') }}
      />
    );
  }

  const t = editing.data;
  let initial: Initial;
  if (t) {
    initial = {
      amount: minorToInput(t.amountMinor, t.currency),
      merchant: t.merchantName ?? '',
      categoryId: t.categoryId,
      source: t.roles.main ? { accountId: t.roles.main.id, instrumentId: t.instrumentId } : null,
      date: t.date,
      note: t.note ?? '',
      items: t.items.map((i) => draftFromItem(i, t.currency)),
      tagIds: t.tags.map((x) => x.id),
    };
  } else {
    const fromParam = params.account ? decodeSource(`acct:${params.account}`, accounts, cards) : null;
    const remembered = decodeSource(lastSource.data, accounts, cards);
    const fallback = accounts.find((a) => a.ownership === 'personal' && a.kind === 'cash') ?? accounts[0];
    initial = {
      amount: '',
      merchant: '',
      categoryId: null,
      source: fromParam ?? remembered ?? { accountId: fallback.id, instrumentId: null },
      date: todayISO(),
      note: '',
      items: [],
      tagIds: [],
    };
  }

  return (
    <ExpenseForm
      id={params.id ?? null}
      initial={initial}
      accounts={accounts}
      cards={cards}
      categories={categories}
    />
  );
}

function ExpenseForm({
  id,
  initial,
  accounts,
  cards,
  categories,
}: {
  id: string | null;
  initial: Initial;
  accounts: AccountWithBalance[];
  cards: PaymentInstrument[];
  categories: Category[];
}) {
  const c = useColors();
  const [amount, setAmount] = useState(initial.amount);
  const [merchant, setMerchant] = useState(initial.merchant);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [categoryTouched, setCategoryTouched] = useState(!!id);
  const [source, setSource] = useState(initial.source);
  const [date, setDate] = useState(initial.date);
  const [note, setNote] = useState(initial.note);
  const [items, setItems] = useState(initial.items);
  const [tagIds, setTagIds] = useState(initial.tagIds);
  const [showMore, setShowMore] = useState(!!initial.note || initial.items.length > 0 || initial.tagIds.length > 0);

  const save = useLedgerMutation(async (db, v: { input: ExpenseInput; another: boolean }) => {
    const txId = await saveExpense(db, v.input, id);
    if (v.input.accountId) {
      await setSetting(db, SETTING.lastExpenseSource, encodeSource({ accountId: v.input.accountId, instrumentId: v.input.instrumentId ?? null }));
    }
    return txId;
  });

  const account = accounts.find((a) => a.id === source?.accountId);
  const currency = account?.currency ?? BASE_CURRENCY;
  const amountMinor = amount.trim() ? parseAmount(amount, currency) : null;
  const parsedItems = items.map((d) => parseDraft(d, currency));
  const isBlank = (d: ItemDraft) => !d.name.trim() && !d.qty.trim() && !d.unitPrice.trim() && !d.total.trim();
  const itemError = parsedItems.find((p, i) => p.error && !isBlank(items[i]));

  const submit = (another: boolean) => {
    if (amountMinor === null || amountMinor <= 0) {
      Alert.alert('Enter an amount', 'How much did you pay?');
      return;
    }
    if (!source) {
      Alert.alert('Where did the money come from?', 'Choose a location or card.');
      return;
    }
    if (itemError) {
      Alert.alert('Check the items', itemError.error ?? '');
      return;
    }
    const input: ExpenseInput = {
      date,
      amountMinor,
      accountId: source.accountId,
      instrumentId: source.instrumentId,
      categoryId,
      merchantName: merchant,
      note,
      tagIds,
      // Rows left completely blank are ignored rather than rejected.
      items: parsedItems.filter((p) => p.input).map((p) => p.input!),
    };
    save.mutate(
      { input, another },
      {
        onSuccess: () => {
          if (another) {
            setAmount('');
            setMerchant('');
            setCategoryId(null);
            setCategoryTouched(false);
            setNote('');
            setItems([]);
            setTagIds([]);
          } else closeScreen();
        },
        onError: (e) => Alert.alert('Could not save', e.message),
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: id ? 'Edit expense' : 'Expense' }} />
      <FormScreen
        footer={
          <>
            {!id && (
              <Button kind="secondary" label="Save & next" onPress={() => submit(true)} disabled={save.isPending} style={{ flex: 1 }} />
            )}
            <Button label="Save" icon="check" onPress={() => submit(false)} loading={save.isPending} style={{ flex: 1.4 }} />
          </>
        }>
        <AmountInput value={amount} onChangeText={setAmount} currency={currency} autoFocus={!id} tint={c.negative} />

        <MerchantField
          label="Where?"
          placeholder="e.g. Moul Lkhodra, BIM, Marjane"
          value={merchant}
          onChange={setMerchant}
          onPick={(m) => {
            setMerchant(m.name);
            if (!categoryTouched && m.defaultCategoryId) setCategoryId(m.defaultCategoryId);
          }}
        />

        <CategoryPicker
          categories={categories}
          value={categoryId}
          onChange={(id) => {
            setCategoryId(id);
            setCategoryTouched(true);
          }}
        />

        <SourcePicker label="Paid from" accounts={accounts} cards={cards ?? []} value={source} onChange={setSource} />

        <DateField value={date} onChange={setDate} />

        {!showMore ? (
          <Button kind="ghost" icon="list_alt" label="Add tags, items, note…" onPress={() => setShowMore(true)} />
        ) : (
          <View>
            <TagPicker value={tagIds} onChange={setTagIds} label="Tags (optional)" />
            <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Anything to remember" multiline />
            <SectionHeader title="Items (optional)" />
            <Text variant="caption" tone="muted" style={{ marginBottom: space.sm }}>
              List what you bought to track product prices. Fill in only what you know.
            </Text>
            <ItemsEditor items={items} onChange={setItems} paidMinor={amountMinor} currency={currency} />
          </View>
        )}
      </FormScreen>
    </>
  );
}
