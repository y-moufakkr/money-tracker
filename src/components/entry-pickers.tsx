import { useState } from 'react';
import { View } from 'react-native';

import { formatMoney } from '@/domain/money';
import { accountKindIcon, type AccountWithBalance, type Category, type PaymentInstrument } from '@/domain/types';
import { useMerchantSuggestions } from '@/hooks/data';
import type { MerchantSuggestion } from '@/services/queries';
import { ChipGroup, Field, TextField } from '@/ui/fields';
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

export function CategoryPicker({
  categories,
  value,
  onChange,
  initialCount = 9,
}: {
  categories: Category[];
  value: string | null;
  onChange: (id: string | null) => void;
  initialCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectedIndex = categories.findIndex((c) => c.id === value);
  const visible =
    expanded || categories.length <= initialCount
      ? categories
      : [
          ...categories.slice(0, initialCount),
          ...(selectedIndex >= initialCount ? [categories[selectedIndex]] : []),
        ];
  return (
    <Field label="Category">
      <ChipGroup>
        {visible.map((cat) => (
          <Chip
            key={cat.id}
            label={cat.name}
            icon={cat.icon ?? undefined}
            color={cat.color ?? undefined}
            selected={value === cat.id}
            onPress={() => onChange(value === cat.id ? null : cat.id)}
          />
        ))}
        {categories.length > initialCount && (
          <Chip label={expanded ? 'Less' : `More (${categories.length - initialCount})`} icon={expanded ? 'expand_less' : 'expand_more'} onPress={() => setExpanded((v) => !v)} />
        )}
      </ChipGroup>
    </Field>
  );
}

/** Free-text merchant with recent/matching suggestions. */
export function MerchantField({
  label,
  placeholder,
  value,
  onChange,
  onPick,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (m: MerchantSuggestion) => void;
}) {
  const { data } = useMerchantSuggestions(value);
  const exact = data?.some((m) => m.name.toLowerCase() === value.trim().toLowerCase());
  const suggestions = (data ?? []).filter((m) => !exact || m.name.toLowerCase() !== value.trim().toLowerCase());
  return (
    <View>
      <TextField label={label} placeholder={placeholder} value={value} onChangeText={onChange} autoCapitalize="words" returnKeyType="done" />
      {suggestions.length > 0 && !exact && (
        <View style={{ marginTop: -space.sm, marginBottom: space.lg }}>
          <ChipGroup>
            {suggestions.slice(0, 6).map((m) => (
              <Chip key={m.id} label={m.name} icon="store" onPress={() => onPick(m)} />
            ))}
          </ChipGroup>
        </View>
      )}
    </View>
  );
}
