import { useState } from 'react';
import { View } from 'react-native';

import { COMPANY_CATEGORIES } from '@/db/seed';
import { formatMoney } from '@/domain/money';
import { accountKindIcon, type AccountWithBalance, type Category, type Ownership, type PaymentInstrument } from '@/domain/types';
import { useMerchantSuggestions } from '@/hooks/data';
import type { MerchantSuggestion } from '@/services/queries';
import { ChipGroup, Field, TextField } from '@/ui/fields';
import { Icon } from '@/ui/icon';
import { Chip, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export type Source = { accountId: string; instrumentId: string | null };

export function encodeSource(s: Source): string {
  return s.instrumentId ? `card:${s.instrumentId}` : `acct:${s.accountId}`;
}

export function decodeSource(v: string | null | undefined, accounts: AccountWithBalance[], cards: PaymentInstrument[]): Source | null {
  if (!v) return null;
  const [type, id] = v.split(':');
  if (type === 'card') {
    const card = cards.find((c) => c.id === id);
    return card && accounts.some((a) => a.id === card.accountId) ? { accountId: card.accountId, instrumentId: card.id } : null;
  }
  return accounts.some((a) => a.id === id) ? { accountId: id, instrumentId: null } : null;
}

/** Locations and debit cards to pay from (or receive into), personal first, then company. */
export function SourcePicker({
  label,
  accounts,
  cards = [],
  value,
  onChange,
  exclude,
  showBalance = true,
}: {
  label: string;
  accounts: AccountWithBalance[];
  cards?: PaymentInstrument[];
  value: Source | null;
  onChange: (s: Source) => void;
  exclude?: string;
  showBalance?: boolean;
}) {
  const c = useColors();
  const visible = accounts.filter((a) => a.id !== exclude);
  const groups = [
    { key: 'personal', title: null as string | null, items: visible.filter((a) => a.ownership === 'personal') },
    { key: 'business', title: 'Company', items: visible.filter((a) => a.ownership === 'business') },
  ].filter((g) => g.items.length > 0);

  return (
    <Field label={label}>
      <View style={{ gap: space.sm }}>
        {groups.map((g) => (
          <View key={g.key} style={{ gap: 6 }}>
            {g.title && groups.length > 1 && (
              <Text variant="caption" color={c.business}>
                {g.title}
              </Text>
            )}
            <ChipGroup>
              {g.items.flatMap((a) => {
                  const tint = a.ownership === 'business' ? c.business : undefined;
                  const bal = showBalance ? ` · ${formatMoney(a.balanceMinor, a.currency)}` : '';
                  const chips = [
                    <Chip
                      key={a.id}
                      label={`${a.name}${bal}`}
                      icon={accountKindIcon(a.kind)}
                      color={tint}
                      selected={value?.accountId === a.id && !value.instrumentId}
                      onPress={() => onChange({ accountId: a.id, instrumentId: null })}
                    />,
                  ];
                  for (const card of cards.filter((x) => x.accountId === a.id)) {
                    chips.push(
                      <Chip
                        key={card.id}
                        label={`${card.name}${card.last4 ? ` ${card.last4}` : ''} → ${a.name}`}
                        icon="credit_card"
                        color={tint}
                        selected={value?.instrumentId === card.id}
                        onPress={() => onChange({ accountId: a.id, instrumentId: card.id })}
                      />,
                    );
                  }
                  return chips;
                })}
            </ChipGroup>
          </View>
        ))}
      </View>
    </Field>
  );
}

const COMPANY_CATEGORY_IDS = new Set(COMPANY_CATEGORIES.map((c) => c.id));

/**
 * Display-only themes for the built-in top-level categories, so the full list is easy to scan.
 * They never change data or reports; categories you nest under a parent form their own group.
 */
const THEMES: { title: string; ids: string[] }[] = [
  { title: 'Food', ids: ['sys-cat-groceries', 'sys-cat-meat-fish', 'sys-cat-veg-fruit', 'sys-cat-snacks', 'sys-cat-restaurants', 'sys-cat-coffee'] },
  { title: 'Transport & car', ids: ['sys-cat-petrol', 'sys-cat-transport', 'sys-cat-car-maintenance'] },
  { title: 'Home & bills', ids: ['sys-cat-electricity', 'sys-cat-water', 'sys-cat-gas', 'sys-cat-internet', 'sys-cat-mobile', 'sys-cat-house-maintenance'] },
  { title: 'Health & family', ids: ['sys-cat-healthcare', 'sys-cat-pregnancy', 'sys-cat-child', 'sys-cat-gym', 'sys-cat-supplements'] },
  { title: 'Shopping & leisure', ids: ['sys-cat-clothes', 'sys-cat-entertainment', 'sys-cat-gifts'] },
  { title: 'Income', ids: ['sys-cat-salary', 'sys-cat-dividends', 'sys-cat-freelancing', 'sys-cat-distributions', 'sys-cat-gifts-received', 'sys-cat-refunds'] },
  { title: 'Company', ids: COMPANY_CATEGORIES.map((c) => c.id) },
  { title: 'Money & other', ids: ['sys-cat-bank-fees', 'sys-cat-loan-interest', 'sys-cat-business', 'sys-cat-miscellaneous', 'sys-cat-other-income'] },
];

/**
 * Categories that fit the chosen location: company system categories (payroll, IS, TVA…) only for
 * company locations, where they come first. Everything else keeps its frequency order.
 */
export function categoriesFor(categories: Category[], ownership: Ownership | null | undefined): Category[] {
  if (ownership === 'business') {
    return [...categories.filter((c) => COMPANY_CATEGORY_IDS.has(c.id)), ...categories.filter((c) => !COMPANY_CATEGORY_IDS.has(c.id))];
  }
  return categories.filter((c) => !COMPANY_CATEGORY_IDS.has(c.id));
}

/** Lower case without accents, so "cafe" finds "Café". */
function fold(s: string): string {
  try {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

/**
 * Most-used categories as chips (the list arrives in order of recent use), plus "All categories":
 * a search box and the full list grouped under each parent category.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  initialCount = 8,
  label = 'Category',
}: {
  categories: Category[];
  value: string | null;
  onChange: (id: string | null) => void;
  initialCount?: number;
  label?: string;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const byId = new Map(categories.map((x) => [x.id, x]));
  const selected = value ? (byId.get(value) ?? null) : null;
  const top = categories.slice(0, initialCount);
  const quick = selected && !top.some((x) => x.id === selected.id) ? [selected, ...top.slice(0, initialCount - 1)] : top;
  const fullName = (x: Category) => {
    const parent = x.parentId ? byId.get(x.parentId) : null;
    return parent ? `${parent.name} › ${x.name}` : x.name;
  };
  const pick = (id: string) => {
    onChange(value === id ? null : id);
    setOpen(false);
    setQuery('');
  };
  const chip = (x: Category, text = x.name) => (
    <Chip key={x.id} label={text} icon={x.icon ?? undefined} color={x.color ?? undefined} selected={value === x.id} onPress={() => pick(x.id)} />
  );

  const q = fold(query.trim());
  const matches = q ? categories.filter((x) => fold(fullName(x)).includes(q)) : [];
  // Groups: each top-level category with its subcategories, alphabetical; orphans under "Other".
  const parents = categories.filter((x) => !x.parentId || !byId.has(x.parentId)).sort((a, b) => a.name.localeCompare(b.name));
  const childrenOf = (id: string) => categories.filter((x) => x.parentId === id).sort((a, b) => a.name.localeCompare(b.name));
  const withChildren = parents.filter((p) => childrenOf(p.id).length > 0);
  const single = parents.filter((p) => childrenOf(p.id).length === 0);
  const themed = THEMES.map((t) => ({ title: t.title, items: single.filter((x) => t.ids.includes(x.id)) })).filter((g) => g.items.length > 0);
  const unthemed = single.filter((x) => !THEMES.some((t) => t.ids.includes(x.id)));

  return (
    <Field label={label}>
      <ChipGroup>
        {quick.map((x) => chip(x))}
        {categories.length > quick.length && (
          <Chip
            label={open ? 'Close' : `All categories (${categories.length})`}
            icon={open ? 'expand_less' : 'search'}
            selected={open}
            onPress={() => {
              setOpen((v) => !v);
              setQuery('');
            }}
          />
        )}
      </ChipGroup>
      {open && (
        <View style={{ marginTop: space.md, padding: space.md, borderRadius: 12, borderWidth: 1, borderColor: c.border, gap: space.sm }}>
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder="Search categories"
            accessibilityLabel="Search categories"
            autoFocus
            leading={<Icon name="search" size={18} color={c.textFaint} />}
          />
          {q ? (
            matches.length === 0 ? (
              <Text tone="muted">No category matches “{query.trim()}”.</Text>
            ) : (
              <ChipGroup>{matches.map((x) => chip(x, fullName(x)))}</ChipGroup>
            )
          ) : (
            <>
              {withChildren.map((p) => (
                <View key={p.id} style={{ gap: 6 }}>
                  <Text variant="caption" tone="muted">
                    {p.name}
                  </Text>
                  <ChipGroup>
                    {chip(p, `${p.name} (all)`)}
                    {childrenOf(p.id).map((x) => chip(x))}
                  </ChipGroup>
                </View>
              ))}
              {[...themed, ...(unthemed.length ? [{ title: themed.length || withChildren.length ? 'Your categories' : '', items: unthemed }] : [])].map((g) => (
                <View key={g.title || 'all'} style={{ gap: 6 }}>
                  {!!g.title && (
                    <Text variant="caption" tone="muted">
                      {g.title}
                    </Text>
                  )}
                  <ChipGroup>{g.items.map((x) => chip(x))}</ChipGroup>
                </View>
              ))}
            </>
          )}
        </View>
      )}
    </Field>
  );
}

/**
 * Free-text merchant / payer with suggestions from history: the places used most recently before
 * anything is typed, then matches while typing.
 */
export function MerchantField({
  label,
  placeholder,
  value,
  onChange,
  onPick,
  kind = 'expense',
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (m: MerchantSuggestion) => void;
  kind?: 'expense' | 'income';
}) {
  const { data } = useMerchantSuggestions(value, kind);
  const typed = value.trim().toLowerCase();
  const exact = data?.some((m) => m.name.toLowerCase() === typed);
  const suggestions = (data ?? []).filter((m) => m.name.toLowerCase() !== typed);
  return (
    <View>
      <TextField label={label} placeholder={placeholder} value={value} onChangeText={onChange} autoCapitalize="words" returnKeyType="done" />
      {suggestions.length > 0 && !exact && (
        <View style={{ marginTop: -space.sm, marginBottom: space.lg, gap: 6 }}>
          <Text variant="caption" tone="faint">
            {typed ? 'Matching places' : 'Recent'}
          </Text>
          <ChipGroup>
            {suggestions.slice(0, 8).map((m) => (
              <Chip key={m.id} label={m.name} icon="store" onPress={() => onPick(m)} />
            ))}
          </ChipGroup>
        </View>
      )}
    </View>
  );
}
