import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { categoriesFor, CategoryPicker, decodeSource, encodeSource, MerchantField, SourcePicker, type Source } from '@/components/entry-pickers';
import { draftFromItem, ItemsEditor, newItemDraft, parseDraft, type ItemDraft } from '@/components/items-editor';
import { PhotoStrip, PhotoThumb, ReceiptHint } from '@/components/receipt-photos';
import { TagPicker } from '@/components/tag-picker';
import { formatDateLabel, todayISO } from '@/domain/dates';
import { BASE_CURRENCY, formatMoney, formatQuantity, minorToInput, parseAmount } from '@/domain/money';
import type { ReceiptItem } from '@/domain/receipt-parse';
import type { AccountWithBalance, Category, PaymentInstrument } from '@/domain/types';
import { useAttachments } from '@/hooks/attachments';
import { useAccountBalances, useCategories, useDb, useInstruments, useLedgerMutation, useMerchantSuggestions, useSetting, useTransaction } from '@/hooks/data';
import { attachmentStore, discardPhoto } from '@/lib/attachment-store';
import { confirmAction, notify } from '@/lib/confirm';
import { closeScreen } from '@/lib/navigation';
import { dropDraft, getDraft, type ReceiptDraft } from '@/lib/receipt-drafts';
import { pickReceiptPhoto, type PickedPhoto } from '@/lib/receipt-photo';
import { findDuplicates, saveExpenseWithAttachments, type Attachment } from '@/services/attachments';
import type { ExpenseInput } from '@/services/ledger';
import { SETTING, setSetting } from '@/services/queries';
import { AmountInput, DateField, TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Button, Card, Chip, EmptyState, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
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
  /** Photos already attached (when editing). */
  stored: Attachment[];
  /** The scanned receipt this form was opened from. */
  receipt: (ReceiptDraft & { id: string }) | null;
};

function itemFromReceipt(it: ReceiptItem, currency: string): ItemDraft {
  return {
    ...newItemDraft(it.lineKind, it.name, minorToInput(it.totalMinor, currency)),
    qty: it.quantityMilli === null ? '' : formatQuantity(it.quantityMilli),
    unit: it.unit ?? '',
    unitPrice: it.unitPriceMinor === null ? '' : minorToInput(it.unitPriceMinor, currency),
  };
}

/** Loads everything the form needs, then mounts the form with its initial values. */
export default function ExpenseScreen() {
  const params = useLocalSearchParams<{ id?: string; account?: string; draft?: string }>();
  const editing = useTransaction(params.id);
  const accounts = useAccountBalances().data;
  const cards = useInstruments().data;
  const categories = useCategories('expense').data;
  const lastSource = useSetting(SETTING.lastExpenseSource);
  const stored = useAttachments(params.id);
  // A scanned receipt, taken once (the draft store is in memory and keyed by the route param).
  const [draft] = useState(() => {
    const d = getDraft(params.draft);
    return d && params.draft ? { ...d, id: params.draft } : null;
  });
  const scannedMerchant = draft?.parse?.merchantName;
  const known = useMerchantSuggestions(scannedMerchant?.merchantId ? scannedMerchant.value : '');

  if (
    !accounts ||
    !cards ||
    !categories ||
    lastSource.isLoading ||
    (params.id && (editing.isLoading || stored.isLoading)) ||
    (scannedMerchant?.merchantId && !known.data)
  ) {
    return <Loading />;
  }
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
      stored: stored.data ?? [],
      receipt: null,
    };
  } else {
    const fromParam = params.account ? decodeSource(`acct:${params.account}`, accounts, cards) : null;
    const remembered = decodeSource(lastSource.data, accounts, cards);
    const fallback = accounts.find((a) => a.ownership === 'personal' && a.kind === 'cash') ?? accounts[0];
    // A known merchant on the receipt: its usual category and where it was paid from last time,
    // exactly as when the merchant is picked on the form.
    const merchant = scannedMerchant?.merchantId ? known.data?.find((m) => m.id === scannedMerchant.merchantId) : undefined;
    // Null-safe locals: the React Compiler may hoist property reads out of guards.
    const lastAccountId = merchant?.last?.accountId ?? null;
    const lastInstrumentId = merchant?.last?.instrumentId ?? null;
    const lastThere =
      lastAccountId && accounts.some((a) => a.id === lastAccountId)
        ? decodeSource(encodeSource({ accountId: lastAccountId, instrumentId: lastInstrumentId }), accounts, cards)
        : null;
    const source = fromParam ?? lastThere ?? remembered ?? { accountId: fallback.id, instrumentId: null };
    const currency = accounts.find((a) => a.id === source.accountId)?.currency ?? BASE_CURRENCY;
    const parse = draft?.parse;
    initial = {
      amount: parse?.totalMinor ? minorToInput(parse.totalMinor.value, currency) : '',
      merchant: parse?.merchantName?.value ?? '',
      categoryId: merchant?.defaultCategoryId ?? null,
      source,
      date: parse?.date.value ?? todayISO(),
      note: '',
      items: parse?.items ? parse.items.value.map((it) => itemFromReceipt(it, currency)) : [],
      tagIds: [],
      stored: [],
      receipt: draft,
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
  const db = useDb();
  const [amount, setAmount] = useState(initial.amount);
  const [merchant, setMerchant] = useState(initial.merchant);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [categoryTouched, setCategoryTouched] = useState(!!id);
  const [source, setSource] = useState(initial.source);
  const [sourceTouched, setSourceTouched] = useState(!!id);
  // What was paid last time at the chosen merchant, offered when no amount is typed yet.
  const [lastAmount, setLastAmount] = useState<{ minor: number; currency: string } | null>(null);
  const [date, setDate] = useState(initial.date);
  const [note, setNote] = useState(initial.note);
  const [items, setItems] = useState(initial.items);
  const [tagIds, setTagIds] = useState(initial.tagIds);
  const [showMore, setShowMore] = useState(!!initial.note || initial.items.length > 0);
  const [receipt, setReceipt] = useState(initial.receipt);
  // Photos not saved yet (temporary files) and stored photos to remove when saving.
  const [photos, setPhotos] = useState<PickedPhoto[]>(initial.receipt ? [initial.receipt.photo] : []);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [checking, setChecking] = useState(false);

  // Leaving without saving (Cancel, back) deletes the temporary photos and the receipt draft.
  const unsaved = useRef<PickedPhoto[]>([]);
  useEffect(() => {
    unsaved.current = photos;
  }, [photos]);
  const draftId = initial.receipt?.id;
  useEffect(
    () => () => {
      for (const p of unsaved.current) discardPhoto(p.uri);
      dropDraft(draftId);
    },
    [draftId],
  );

  const save = useLedgerMutation(async (db, v: { input: ExpenseInput; photos: PickedPhoto[]; removeIds: string[]; another: boolean }) => {
    const txId = await saveExpenseWithAttachments(db, attachmentStore, v.input, id, {
      add: v.photos.map((p) => ({ bytes: p.bytes, mime: p.mime })),
      removeIds: v.removeIds,
    });
    if (v.input.accountId) {
      await setSetting(db, SETTING.lastExpenseSource, encodeSource({ accountId: v.input.accountId, instrumentId: v.input.instrumentId ?? null }));
    }
    return txId;
  });

  const sourceId = source?.accountId ?? null;
  const account = accounts.find((a) => a.id === sourceId);
  const shownCategories = categoriesFor(categories, account?.ownership);
  const currency = account?.currency ?? BASE_CURRENCY;
  const amountMinor = amount.trim() ? parseAmount(amount, currency) : null;
  const parsedItems = items.map((d) => parseDraft(d, currency));
  const isBlank = (d: ItemDraft) => !d.name.trim() && !d.qty.trim() && !d.unitPrice.trim() && !d.total.trim();
  const itemError = parsedItems.find((p, i) => p.error && !isBlank(items[i]));
  const storedShown = initial.stored.filter((a) => !removeIds.includes(a.id));

  // Fields still holding what was read from the receipt are marked "check this".
  const parse = receipt?.parse ?? null;
  const hint = {
    amount: parse?.totalMinor && amount === initial.amount ? parse.totalMinor.confidence : null,
    merchant: parse?.merchantName && merchant === initial.merchant ? parse.merchantName.confidence : null,
    date: parse && date === initial.date ? parse.date.confidence : null,
    items: parse?.items && items === initial.items ? parse.items.confidence : null,
  };

  const addPhoto = async (from: 'camera' | 'library') => {
    setPicking(true);
    try {
      const p = await pickReceiptPhoto(from);
      if (p) setPhotos((prev) => [...prev, p]);
    } catch (e) {
      notify('No photo', (e as Error).message);
    } finally {
      setPicking(false);
    }
  };
  const removePhoto = (uri: string) => {
    discardPhoto(uri);
    setPhotos((prev) => prev.filter((p) => p.uri !== uri));
  };

  const submit = (another: boolean) => {
    if (amountMinor === null || amountMinor <= 0) {
      notify('Enter an amount', 'How much did you pay?');
      return;
    }
    if (!source) {
      notify('Where did the money come from?', 'Choose a location or card.');
      return;
    }
    if (itemError) {
      notify('Check the items', itemError.error ?? '');
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
    const sending = photos;
    const run = () =>
      save.mutate(
        { input, photos: sending, removeIds, another },
        {
          onSuccess: () => {
            // The photos are now stored with the expense; the temporary files can go.
            for (const p of sending) discardPhoto(p.uri);
            setPhotos([]);
            setRemoveIds([]);
            if (another) {
              setAmount('');
              setMerchant('');
              setCategoryId(null);
              setCategoryTouched(false);
              setLastAmount(null);
              setNote('');
              setItems([]);
              setTagIds([]);
              setReceipt(null);
            } else closeScreen();
          },
          onError: (e) => notify('Could not save', e.message),
        },
      );

    // Duplicate guard: the same photo, or the same amount, date and merchant, already recorded.
    setChecking(true);
    findDuplicates(db, { sha256s: sending.map((p) => p.sha256), amountMinor, date, merchantName: merchant, excludeId: id })
      .then((d) => {
        if (!d.sameImage.length && !d.sameExpense.length) return run();
        const describe = (m: (typeof d.sameExpense)[number]) =>
          `${formatMoney(m.amountMinor, m.currency)}${m.merchantName ? ` at ${m.merchantName}` : ''} (${formatDateLabel(m.date)})`;
        const lines = [
          ...(d.sameImage.length ? [`This photo is already attached to: ${describe(d.sameImage[0])}.`] : []),
          ...(d.sameExpense.length ? [`An expense with the same amount, date and merchant exists: ${describe(d.sameExpense[0])}.`] : []),
        ];
        confirmAction('Already recorded?', `${lines.join('\n\n')}\n\nSaving it again would count this money twice.`, 'Save anyway', run);
      })
      .catch((e: Error) => notify('Could not save', e.message))
      .finally(() => setChecking(false));
  };

  const warnings = [...(receipt?.error ? [receipt.error] : []), ...(parse?.warnings ?? [])];

  return (
    <>
      <Stack.Screen options={{ title: id ? 'Edit expense' : 'Expense' }} />
      <FormScreen
        footer={
          <>
            {!id && (
              <Button kind="secondary" label="Save & next" onPress={() => submit(true)} disabled={save.isPending || checking} style={{ flex: 1 }} />
            )}
            <Button label="Save" icon="check" onPress={() => submit(false)} loading={save.isPending || checking} style={{ flex: 1.4 }} />
          </>
        }>
        {receipt && (
          <Card style={{ marginBottom: space.md, gap: space.sm }} tone="primary">
            <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
              <PhotoThumb uri={receipt.photo.uri} size={64} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">From receipt</Text>
                <Text variant="caption" tone="muted">
                  {parse
                    ? 'Check the marked fields, then Save. Nothing is saved until you do.'
                    : 'The photo is attached. Fill in the expense, then Save.'}
                </Text>
              </View>
            </Row>
            {warnings.map((w) => (
              <Text key={w} variant="caption" color={c.warning}>
                • {w}
              </Text>
            ))}
          </Card>
        )}

        <AmountInput value={amount} onChangeText={setAmount} currency={currency} autoFocus={!id && !receipt} tint={c.negative} />
        {hint.amount && <ReceiptHint confidence={hint.amount} />}

        {lastAmount && !amount.trim() && (
          <View style={{ alignItems: 'center', marginTop: -space.sm, marginBottom: space.md }}>
            <Chip
              label={`Same as last time: ${formatMoney(lastAmount.minor, lastAmount.currency)}`}
              icon="history"
              onPress={() => setAmount(minorToInput(lastAmount.minor, lastAmount.currency))}
            />
          </View>
        )}

        <MerchantField
          label="Where?"
          placeholder="e.g. Moul Lkhodra, BIM, Marjane"
          value={merchant}
          onChange={(v) => {
            setMerchant(v);
            setLastAmount(null);
          }}
          onPick={(m) => {
            setMerchant(m.name);
            if (!categoryTouched && m.defaultCategoryId) setCategoryId(m.defaultCategoryId);
            // Paid there before: suggest the same location (unless chosen by hand) and amount.
            const usable = m.last && accounts.some((a) => a.id === m.last!.accountId);
            if (m.last && usable && !sourceTouched) {
              setSource(decodeSource(encodeSource({ accountId: m.last.accountId, instrumentId: m.last.instrumentId }), accounts, cards) ?? source);
            }
            setLastAmount(m.last ? { minor: m.last.amountMinor, currency: m.last.currency } : null);
          }}
        />
        {hint.merchant && <ReceiptHint confidence={hint.merchant} />}

        <SourcePicker
          label="Paid from"
          accounts={accounts}
          cards={cards ?? []}
          value={source}
          onChange={(s) => {
            setSource(s);
            setSourceTouched(true);
          }}
        />

        <CategoryPicker
          categories={shownCategories}
          value={categoryId}
          onChange={(id) => {
            setCategoryId(id);
            setCategoryTouched(true);
          }}
        />

        <DateField value={date} onChange={setDate} />
        {hint.date && <ReceiptHint confidence={hint.date} />}

        <TagPicker value={tagIds} onChange={setTagIds} label="Tags (optional)" />

        <SectionHeader title="Receipt photo (optional)" />
        <PhotoStrip
          stored={storedShown}
          pending={photos.map((p) => ({ key: p.uri, uri: p.uri }))}
          onRemoveStored={(aid) => setRemoveIds((prev) => [...prev, aid])}
          onRemovePending={removePhoto}
          onAdd={(from) => void addPhoto(from)}
          busy={picking}
        />
        {removeIds.length > 0 && (
          <Text variant="caption" tone="muted" style={{ marginTop: -space.sm, marginBottom: space.md }}>
            {removeIds.length === 1 ? 'The removed photo is deleted' : 'The removed photos are deleted'} when you save.
          </Text>
        )}

        {!showMore ? (
          <Button kind="ghost" icon="list_alt" label="Add items, note…" onPress={() => setShowMore(true)} />
        ) : (
          <View>
            <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Anything to remember" multiline />
            <SectionHeader title="Items (optional)" />
            <Text variant="caption" tone="muted" style={{ marginBottom: space.sm }}>
              List what you bought to track product prices. Fill in only what you know.
            </Text>
            {hint.items && <ReceiptHint confidence={hint.items} />}
            <ItemsEditor items={items} onChange={setItems} paidMinor={amountMinor} currency={currency} />
          </View>
        )}
      </FormScreen>
    </>
  );
}
