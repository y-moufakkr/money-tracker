import { StyleSheet, TextInput, View } from 'react-native';

import { formatMoney, formatQuantity, lineTotal, minorToInput, parseAmount, parseQuantity } from '@/domain/money';
import type { ItemLineKind, PurchaseItem, PurchaseItemInput } from '@/domain/types';
import { useProductSuggestions } from '@/hooks/data';
import { ChipGroup } from '@/ui/fields';
import { Button, Chip, IconButton, Row, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

export type ItemDraft = {
  key: string;
  lineKind: ItemLineKind;
  name: string;
  qty: string;
  unit: string;
  unitPrice: string;
  total: string;
};

let seq = 0;
export function newItemDraft(lineKind: ItemLineKind = 'product', name = '', total = ''): ItemDraft {
  seq += 1;
  return { key: `item-${seq}`, lineKind, name, qty: '', unit: '', unitPrice: '', total };
}

export function draftFromItem(i: PurchaseItem, currency: string): ItemDraft {
  return {
    ...newItemDraft(i.lineKind, i.name),
    qty: i.quantityMilli === null ? '' : formatQuantity(i.quantityMilli),
    unit: i.unit ?? '',
    unitPrice: i.unitPriceMinor === null ? '' : minorToInput(i.unitPriceMinor, currency),
    total: i.totalMinor === null ? '' : minorToInput(i.totalMinor, currency),
  };
}

type Parsed = { input: PurchaseItemInput | null; error: string | null; effectiveTotal: number | null };

/**
 * Parses a draft. Only derives the total when both quantity and unit price
 * were entered — never invents missing quantities or prices.
 */
export function parseDraft(d: ItemDraft, currency: string): Parsed {
  if (!d.name.trim()) return { input: null, error: 'Name required', effectiveTotal: null };
  const qty = d.qty.trim() ? parseQuantity(d.qty) : null;
  const unitPrice = d.unitPrice.trim() ? parseAmount(d.unitPrice, currency) : null;
  const total = d.total.trim() ? parseAmount(d.total, currency) : null;
  if (d.qty.trim() && qty === null) return { input: null, error: 'Invalid quantity', effectiveTotal: null };
  if (d.unitPrice.trim() && unitPrice === null) return { input: null, error: 'Invalid price', effectiveTotal: null };
  if (d.total.trim() && total === null) return { input: null, error: 'Invalid total', effectiveTotal: null };
  if (d.lineKind !== 'product' && total === null) return { input: null, error: 'Amount required', effectiveTotal: null };
  const derived = total ?? (qty !== null && unitPrice !== null ? lineTotal(unitPrice, qty) : null);
  return {
    input: {
      lineKind: d.lineKind,
      name: d.name.trim(),
      quantityMilli: qty,
      unit: d.unit.trim() || null,
      unitPriceMinor: unitPrice,
      totalMinor: derived,
    },
    error: null,
    effectiveTotal: derived,
  };
}

/** Signed contribution of a line to the receipt: discounts reduce it. */
export function signedTotal(p: Parsed, kind: ItemLineKind) {
  if (p.effectiveTotal === null) return 0;
  return kind === 'discount' ? -p.effectiveTotal : p.effectiveTotal;
}

const QUICK_UNITS = ['kg', 'g', 'L', 'piece', 'pack'];
const KIND_LABEL: Record<ItemLineKind, string> = {
  product: 'Item',
  discount: 'Discount',
  charge: 'Extra charge',
  unallocated: 'Other / unallocated',
};

function ItemCard({
  d,
  currency,
  onChange,
  onRemove,
}: {
  d: ItemDraft;
  currency: string;
  onChange: (d: ItemDraft) => void;
  onRemove: () => void;
}) {
  const c = useColors();
  const parsed = parseDraft(d, currency);
  const isProduct = d.lineKind === 'product';
  const suggestions = useProductSuggestions(d.name, isProduct && d.name.length >= 1).data ?? [];
  const showSuggestions =
    isProduct && d.name.length > 0 && suggestions.length > 0 && !suggestions.some((s) => s.name.toLowerCase() === d.name.trim().toLowerCase());
  const input = [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }];

  return (
    <View style={[styles.item, { backgroundColor: c.surfaceAlt }]}>
      <Row>
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          {KIND_LABEL[d.lineKind]}
        </Text>
        {parsed.effectiveTotal !== null && (
          <Text variant="label" color={d.lineKind === 'discount' ? c.positive : c.text}>
            {d.lineKind === 'discount' ? '−' : ''}
            {formatMoney(parsed.effectiveTotal, currency)}
          </Text>
        )}
        <IconButton icon="close" label="Remove item" size={18} onPress={onRemove} />
      </Row>
      <TextInput
        value={d.name}
        onChangeText={(name) => onChange({ ...d, name })}
        placeholder={isProduct ? 'Product, e.g. Tomatoes' : 'Description'}
        placeholderTextColor={c.textFaint}
        style={input}
        autoCapitalize="sentences"
      />
      {showSuggestions && (
        <ChipGroup>
          {suggestions.slice(0, 4).map((s) => (
            <Chip
              key={s.name}
              label={s.lastUnitPriceMinor !== null ? `${s.name} · ${formatMoney(s.lastUnitPriceMinor, currency)}${s.unit ? `/${s.unit}` : ''}` : s.name}
              onPress={() => onChange({ ...d, name: s.name, unit: d.unit || s.unit || '' })}
            />
          ))}
        </ChipGroup>
      )}
      {isProduct ? (
        <>
          <Row>
            <TextInput
              value={d.qty}
              onChangeText={(qty) => onChange({ ...d, qty })}
              placeholder="Qty"
              keyboardType="decimal-pad"
              placeholderTextColor={c.textFaint}
              style={[input, { flex: 1 }]}
            />
            <TextInput
              value={d.unit}
              onChangeText={(unit) => onChange({ ...d, unit })}
              placeholder="Unit"
              placeholderTextColor={c.textFaint}
              style={[input, { flex: 1 }]}
              autoCapitalize="none"
            />
          </Row>
          <Row>
            <TextInput
              value={d.unitPrice}
              onChangeText={(unitPrice) => onChange({ ...d, unitPrice })}
              placeholder="Price/unit"
              keyboardType="decimal-pad"
              placeholderTextColor={c.textFaint}
              style={[input, { flex: 1 }]}
            />
            <TextInput
              value={d.total}
              onChangeText={(total) => onChange({ ...d, total })}
              placeholder={
                parsed.effectiveTotal !== null && !d.total ? minorToInput(parsed.effectiveTotal, currency) : 'Total'
              }
              keyboardType="decimal-pad"
              placeholderTextColor={c.textFaint}
              style={[input, { flex: 1 }]}
            />
          </Row>
          <ChipGroup>
            {QUICK_UNITS.map((u) => (
              <Chip key={u} label={u} selected={d.unit === u} onPress={() => onChange({ ...d, unit: d.unit === u ? '' : u })} />
            ))}
          </ChipGroup>
        </>
      ) : (
        <TextInput
          value={d.total}
          onChangeText={(total) => onChange({ ...d, total })}
          placeholder="Amount"
          keyboardType="decimal-pad"
          placeholderTextColor={c.textFaint}
          style={input}
        />
      )}
      {parsed.error && d.name.trim() !== '' && (
        <Text variant="caption" color={c.negative}>
          {parsed.error}
        </Text>
      )}
    </View>
  );
}

export function ItemsEditor({
  items,
  onChange,
  paidMinor,
  currency,
}: {
  items: ItemDraft[];
  onChange: (items: ItemDraft[]) => void;
  paidMinor: number | null;
  currency: string;
}) {
  const c = useColors();
  const parsed = items.map((d) => parseDraft(d, currency));
  const itemsTotal = parsed.reduce((sum, p, i) => sum + signedTotal(p, items[i].lineKind), 0);
  const unknown = parsed.filter((p, i) => items[i].lineKind === 'product' && p.effectiveTotal === null).length;
  const gap = paidMinor === null ? null : paidMinor - itemsTotal;

  const update = (key: string, d: ItemDraft) => onChange(items.map((x) => (x.key === key ? d : x)));
  const remove = (key: string) => onChange(items.filter((x) => x.key !== key));

  return (
    <View style={{ gap: space.sm }}>
      {items.map((d) => (
        <ItemCard key={d.key} d={d} currency={currency} onChange={(n) => update(d.key, n)} onRemove={() => remove(d.key)} />
      ))}
      <Row style={{ flexWrap: 'wrap' }}>
        <Button compact kind="secondary" icon="add" label="Add item" onPress={() => onChange([...items, newItemDraft()])} />
        <Button compact kind="ghost" label="Discount" onPress={() => onChange([...items, newItemDraft('discount', 'Discount')])} />
        <Button compact kind="ghost" label="Extra charge" onPress={() => onChange([...items, newItemDraft('charge', 'Extra charge')])} />
      </Row>

      {items.length > 0 && paidMinor !== null && (
        <View style={[styles.summary, { borderColor: gap === 0 ? c.positive : c.border }]}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label" tone="muted">
              Items total{unknown > 0 ? ` (${unknown} without price)` : ''}
            </Text>
            <Text variant="label">{formatMoney(itemsTotal, currency)}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label" tone="muted">
              Amount paid
            </Text>
            <Text variant="label">{formatMoney(paidMinor, currency)}</Text>
          </Row>
          {gap !== 0 && gap !== null && (
            <>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label" color={c.warning}>
                  {gap > 0 ? 'Not itemised' : 'Items exceed amount paid'}
                </Text>
                <Text variant="label" color={c.warning}>
                  {formatMoney(Math.abs(gap), currency)}
                </Text>
              </Row>
              <Text variant="caption" tone="muted">
                That is fine — nothing is guessed. You can label the difference explicitly:
              </Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {gap > 0 ? (
                  <Button
                    compact
                    kind="secondary"
                    label="Add as “other items”"
                    onPress={() => onChange([...items, newItemDraft('unallocated', 'Other items', minorToInput(gap, currency))])}
                  />
                ) : (
                  <Button
                    compact
                    kind="secondary"
                    label="Add as discount"
                    onPress={() => onChange([...items, newItemDraft('discount', 'Discount', minorToInput(-gap, currency))])}
                  />
                )}
              </Row>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
    fontSize: 15,
    minHeight: 42,
    minWidth: 0,
  },
  summary: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 6, marginTop: space.sm },
});
