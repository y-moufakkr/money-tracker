import { useState } from 'react';
import { SectionList, View } from 'react-native';

import { formatDateLabel } from '@/domain/dates';
import { formatMoney, minorToInput, parseAmount } from '@/domain/money';
import { PRICE_BOOK_DATE, PRICE_GROUP_LABEL, type PriceGroup } from '@/domain/price-book';
import { nameTokens, PRICE_SOURCE_LABEL, type PriceRef } from '@/domain/price-estimate';
import { useLedgerMutation, usePriceBook } from '@/hooks/data';
import { notify } from '@/lib/confirm';
import { deleteMyPrice, saveMyPrice, type MyPrice, type PriceBookRow } from '@/services/prices';
import { ChipGroup, TextField } from '@/ui/fields';
import { Icon } from '@/ui/icon';
import { Button, Card, Chip, Divider, EmptyState, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const UNITS = ['kg', 'g', 'L', 'piece', 'pack', 'dozen', 'bottle', 'box'];
const GROUP_ORDER: (PriceGroup | 'yours')[] = ['yours', ...(Object.keys(PRICE_GROUP_LABEL) as PriceGroup[])];

const perUnit = (ref: PriceRef) => (ref.unit === null ? `${formatMoney(ref.priceMinor)} a purchase` : `${formatMoney(ref.priceMinor)}/${ref.unit}`);

/** Price and unit for your own price; with `named`, also the name (a new entry). */
function PriceEditor({
  initial,
  named,
  onDone,
}: {
  initial: { name: string; unit: string; priceMinor: number | null; mine: MyPrice | null };
  named?: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState(initial.priceMinor === null ? '' : minorToInput(initial.priceMinor));
  const [unit, setUnit] = useState(initial.unit);
  const save = useLedgerMutation(saveMyPrice);
  const remove = useLedgerMutation(deleteMyPrice);
  const priceMinor = price.trim() ? parseAmount(price) : null;
  // A null-safe local: the React Compiler reads closure values during render (new entries have no row).
  const mineId = initial.mine?.id ?? null;

  const submit = () => {
    if (priceMinor === null || priceMinor <= 0) return notify('Price needed', 'Enter what one unit usually costs.');
    save.mutate({ name, unit, priceMinor }, { onSuccess: onDone, onError: (e) => notify('Not saved', e.message) });
  };

  return (
    <View style={{ gap: space.sm, paddingTop: space.sm }}>
      {named && <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Croquettes chat" autoCapitalize="sentences" />}
      <TextField
        label={`Usual price per ${unit || 'unit'}`}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="0.00"
        error={price.trim() && priceMinor === null ? 'Invalid price' : null}
      />
      <ChipGroup>
        {UNITS.map((u) => (
          <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
        ))}
      </ChipGroup>
      <Row style={{ flexWrap: 'wrap' }}>
        <Button compact label="Save my price" onPress={submit} loading={save.isPending} />
        {mineId && (
          <Button
            compact
            kind="ghost"
            label="Remove my price"
            onPress={() => remove.mutate(mineId, { onSuccess: onDone, onError: (e) => notify('Not removed', e.message) })}
          />
        )}
        <Button compact kind="ghost" label="Cancel" onPress={onDone} />
      </Row>
    </View>
  );
}

function PriceRow({ row, open, onToggle }: { row: PriceBookRow; open: boolean; onToggle: () => void }) {
  const c = useColors();
  const { active } = row;
  const others = [
    row.history && row.history !== active ? `purchases ${perUnit(row.history)}` : null,
    row.mine && active.source !== 'mine' ? `yours ${formatMoney(row.mine.priceMinor)}/${row.mine.unit}` : null,
    row.starter && active.source !== 'starter' ? `starter ${perUnit(row.starter)}` : null,
  ].filter(Boolean);
  const subtitle = [
    `From ${PRICE_SOURCE_LABEL[active.source]}${active.source === 'history' && active.date ? `, ${formatDateLabel(active.date)}` : ''}`,
    ...others,
  ].join(' · ');
  const editUnit = row.mine?.unit ?? (active.unit ?? row.starter?.unit ?? 'piece');

  return (
    <View style={{ backgroundColor: c.surface, paddingHorizontal: open ? space.md : 0, paddingBottom: open ? space.md : 0 }}>
      <ListItem
        title={row.name}
        subtitle={subtitle}
        right={
          <Text variant="label" color={active.source === 'starter' ? c.textMuted : c.text} style={{ fontVariant: ['tabular-nums'] }}>
            {perUnit(active)}
          </Text>
        }
        onPress={onToggle}
      />
      {open && (
        <PriceEditor
          initial={{
            name: row.mine?.name ?? row.name,
            unit: editUnit,
            priceMinor: row.mine?.priceMinor ?? (active.unit === editUnit ? active.priceMinor : null),
            mine: row.mine,
          }}
          onDone={onToggle}
        />
      )}
    </View>
  );
}

export default function UsualPricesScreen() {
  const c = useColors();
  const [search, setSearch] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = usePriceBook();

  const words = nameTokens(search);
  const matches = (r: PriceBookRow) => {
    if (words.length === 0) return true;
    const names = [r.name, r.mine?.name, r.history?.name, ...(r.starter?.aliases ?? [])].filter((n): n is string => !!n);
    return names.some((n) => {
      const t = nameTokens(n);
      return words.every((w) => t.some((x) => x.startsWith(w)));
    });
  };
  const rows = (data ?? []).filter(matches);
  const sections = GROUP_ORDER.map((g) => ({
    key: g,
    title: g === 'yours' ? 'Only in your list' : PRICE_GROUP_LABEL[g],
    data: rows.filter((r) => r.group === g).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((s) => s.data.length > 0);

  return (
    <SectionList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}
      keyboardShouldPersistTaps="handled"
      sections={sections}
      keyExtractor={(r) => r.key}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={{ gap: space.sm, marginBottom: space.sm }}>
          <Text variant="caption" tone="muted">
            When an expense has items without a price, the amount paid is split across them by these usual prices. Your
            purchases and your own prices replace the starter list (Morocco, {PRICE_BOOK_DATE}). Estimates are never used as
            prices.
          </Text>
          {adding ? (
            <Card>
              <PriceEditor initial={{ name: '', unit: 'piece', priceMinor: null, mine: null }} named onDone={() => setAdding(false)} />
            </Card>
          ) : (
            <Button compact kind="secondary" icon="add" label="Add a price" onPress={() => setAdding(true)} style={{ alignSelf: 'flex-start' }} />
          )}
          <TextField
            placeholder="Search (tomate, djaj, milk…)"
            value={search}
            onChangeText={setSearch}
            leading={<Icon name="search" size={20} color={c.textFaint} />}
          />
        </View>
      }
      renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
      ListEmptyComponent={isLoading ? <Loading /> : <EmptyState icon="sell" title="No price matches" />}
      ItemSeparatorComponent={() => <Divider inset={16} />}
      renderItem={({ item }) => (
        <PriceRow row={item} open={openKey === item.key} onToggle={() => setOpenKey(openKey === item.key ? null : item.key)} />
      )}
    />
  );
}
