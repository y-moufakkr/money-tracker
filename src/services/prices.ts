/**
 * Usual prices used to estimate item lines without a price: learned from your purchases, your own
 * price list (`price_refs`), and the starter list shipped with the app. None of this moves money.
 */
import { LedgerError, type Db } from '@/db/types';
import { BASE_CURRENCY } from '@/domain/money';
import { PRICE_BOOK, type PriceGroup } from '@/domain/price-book';
import { nameKey, STARTER_REFS, type PriceRef } from '@/domain/price-estimate';
import { groupUnitLabel, normaliseQuantity, unitGroup } from '@/domain/units';
import { newId, nowISO } from '@/lib/id';

/** How many of the latest purchases of a product make its learned price. */
const RECENT = 3;

/**
 * One learned price per product, from its latest recorded (never estimated) lines in base-currency
 * accounts: Σ amount ÷ Σ quantity of the last few purchases in the unit group of the latest one,
 * per kg, L, piece or the recorded unit. A product never bought with a quantity gets the average
 * amount of its last purchases, as a price per purchase.
 */
export async function learnedPrices(db: Db): Promise<PriceRef[]> {
  const rows = await db.all<{
    product_id: string;
    name: string;
    date: string;
    quantity_milli: number | null;
    unit: string | null;
    total_minor: number;
  }>(
    `SELECT pi.product_id, pr.name, t.date, pi.quantity_milli, pi.unit, pi.total_minor
     FROM purchase_items pi
     JOIN products pr ON pr.id = pi.product_id
     JOIN transactions t ON t.id = pi.transaction_id
     JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     JOIN accounts a ON a.id = p.account_id
     WHERE t.deleted_at IS NULL AND t.kind = 'expense' AND pi.line_kind = 'product' AND pi.estimated = 0
       AND pi.total_minor IS NOT NULL AND pi.total_minor > 0 AND a.currency = ?
     ORDER BY t.date DESC, pi.created_at DESC`,
    [BASE_CURRENCY],
  );
  const byProduct = new Map<string, typeof rows>();
  for (const r of rows) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r]);

  const refs: PriceRef[] = [];
  for (const lines of byProduct.values()) {
    const measured = lines.filter((l) => l.quantity_milli !== null && unitGroup(l.unit) !== 'none');
    if (measured.length > 0) {
      const group = unitGroup(measured[0].unit);
      const recent = measured.filter((l) => unitGroup(l.unit) === group).slice(0, RECENT);
      const qtyMicro = recent.reduce((s, l) => s + normaliseQuantity(l.quantity_milli, l.unit)!, 0);
      const spent = recent.reduce((s, l) => s + l.total_minor, 0);
      const unit = groupUnitLabel(group)!;
      const perUnitMicro = normaliseQuantity(1000, unit)!;
      refs.push({
        name: lines[0].name,
        unit,
        priceMinor: Math.round((spent * perUnitMicro) / qtyMicro),
        typicalMilli: Math.round((normaliseQuantity(recent[0].quantity_milli, recent[0].unit)! * 1000) / perUnitMicro),
        source: 'history',
        date: recent[0].date,
      });
    } else {
      const recent = lines.slice(0, RECENT);
      refs.push({
        name: lines[0].name,
        unit: null,
        priceMinor: Math.round(recent.reduce((s, l) => s + l.total_minor, 0) / recent.length),
        typicalMilli: null,
        source: 'history',
        date: recent[0].date,
      });
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Your own price list

export type MyPrice = { id: string; name: string; unit: string; priceMinor: number; updatedAt: string };

export async function listMyPrices(db: Db): Promise<MyPrice[]> {
  const rows = await db.all<{ id: string; name: string; unit: string; price_minor: number; updated_at: string }>(
    'SELECT id, name, unit, price_minor, updated_at FROM price_refs ORDER BY name',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, priceMinor: r.price_minor, updatedAt: r.updated_at }));
}

const myRef = (m: MyPrice): PriceRef => ({
  name: m.name,
  unit: m.unit,
  priceMinor: m.priceMinor,
  typicalMilli: null,
  source: 'mine',
  date: m.updatedAt.slice(0, 10),
});

export type MyPriceInput = { name: string; unit: string; priceMinor: number };

/** Adds or replaces your usual price for a name (one price per name, any case). */
export async function saveMyPrice(db: Db, input: MyPriceInput): Promise<string> {
  const name = input.name.trim();
  const unit = input.unit.trim();
  if (!name) throw new LedgerError('Name is required.');
  if (!unit) throw new LedgerError('Choose a unit.');
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor <= 0) throw new LedgerError('Enter a price above zero.');
  return db.transaction(async (tx) => {
    const ts = nowISO();
    const existing = await tx.first<{ id: string }>('SELECT id FROM price_refs WHERE name = ? COLLATE NOCASE', [name]);
    if (existing) {
      await tx.run('UPDATE price_refs SET name = ?, unit = ?, price_minor = ?, updated_at = ? WHERE id = ?', [
        name,
        unit,
        input.priceMinor,
        ts,
        existing.id,
      ]);
      return existing.id;
    }
    const id = newId();
    await tx.run('INSERT INTO price_refs (id, name, unit, price_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      name,
      unit,
      input.priceMinor,
      ts,
      ts,
    ]);
    return id;
  });
}

export async function deleteMyPrice(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM price_refs WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Everything together

export type PriceBookRow = {
  key: string;
  name: string;
  /** Starter-list group, or 'yours' for names only you or your purchases know. */
  group: PriceGroup | 'yours';
  starter: PriceRef | null;
  mine: MyPrice | null;
  history: PriceRef | null;
  /** The price an estimate uses for this name: the more recent of yours and your purchases', else the starter one. */
  active: PriceRef;
};

/**
 * The price list: each starter item with your price and your purchases' price when they name the
 * same thing (its name or an alias), then everything only you have.
 */
export async function priceBook(db: Db): Promise<PriceBookRow[]> {
  const [history, mine] = await Promise.all([learnedPrices(db), listMyPrices(db)]);
  type Draft = Omit<PriceBookRow, 'active'>;
  const rows = new Map<string, Draft>();
  PRICE_BOOK.forEach((e, i) => {
    rows.set(nameKey(e.name), { key: nameKey(e.name), name: e.name, group: e.group, starter: STARTER_REFS[i], mine: null, history: null });
  });
  const rowFor = (name: string): Draft => {
    const key = nameKey(name);
    const known = rows.get(key) ?? [...rows.values()].find((r) => r.starter?.aliases?.some((a) => nameKey(a) === key));
    if (known) return known;
    const row: Draft = { key, name, group: 'yours', starter: null, mine: null, history: null };
    rows.set(key, row);
    return row;
  };
  for (const m of mine) rowFor(m.name).mine = m;
  for (const h of history) {
    const row = rowFor(h.name);
    if (!row.history || (h.date ?? '') > (row.history.date ?? '')) row.history = h;
  }
  return [...rows.values()].map((r) => {
    const own = [r.history, r.mine ? myRef(r.mine) : null]
      .filter((x): x is PriceRef => x !== null)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return { ...r, active: own[0] ?? r.starter! };
  });
}

/**
 * Every usual price the estimator can use. Your price and your purchases' price for a starter item
 * also answer to its names, so "Tomates" finds the price you set on "Tomatoes".
 */
export async function loadPriceRefs(db: Db): Promise<PriceRef[]> {
  return (await priceBook(db)).flatMap((r) => {
    const aliases = r.starter ? [r.starter.name, ...(r.starter.aliases ?? [])] : [];
    const own = [r.history, r.mine ? myRef(r.mine) : null].filter((x): x is PriceRef => x !== null);
    return [...own.map((x) => ({ ...x, aliases })), ...(r.starter ? [r.starter] : [])];
  });
}
