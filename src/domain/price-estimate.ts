/**
 * Estimated item prices. When an expense lists items without prices, the part of the amount paid
 * that no priced line explains is split across them in proportion to what each usually costs.
 * The estimates always add up to exactly that part, so the lines add up to the amount paid and
 * nothing is counted twice. An estimate is marked as such and is never used as a price.
 *
 * Usual costs come from, in order of match quality: your purchases and your own price list (the
 * more recent of the two wins), then the starter list (`price-book.ts`).
 */
import { PRICE_BOOK } from './price-book';
import type { ItemLineKind } from './types';
import { areCompatible, normaliseQuantity } from './units';

export type PriceSource = 'history' | 'mine' | 'starter';

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  history: 'your purchases',
  mine: 'your price list',
  starter: 'starter price list',
};

export type PriceRef = {
  name: string;
  aliases?: readonly string[];
  /** Null: `priceMinor` is what one purchase usually costs (no quantity was ever recorded). */
  unit: string | null;
  /** Price of one `unit`, or of one purchase when `unit` is null. */
  priceMinor: number;
  /** Usual quantity bought, in thousandths of `unit`. */
  typicalMilli: number | null;
  source: PriceSource;
  /** YYYY-MM-DD: latest purchase (history) or last edit (mine). */
  date: string | null;
};

export const STARTER_REFS: readonly PriceRef[] = PRICE_BOOK.map((e) => ({
  name: e.name,
  aliases: e.aliases,
  unit: e.unit,
  priceMinor: e.priceMinor,
  typicalMilli: e.typicalMilli,
  source: 'starter',
  date: null,
}));

// ---------------------------------------------------------------------------
// Names

const STOP_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'au', 'en', 'et', 'of', 'and']);
const SIZE = /\b(\d+(?:[.,]\d+)?)\s*(kg|kgs|g|gr|l|cl|ml)\b/i;

function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (w.endsWith('eaux')) return w.slice(0, -1);
  if (w.endsWith('s') || w.endsWith('x')) return w.slice(0, -1);
  return w;
}

/** Lower-case words without accents, sizes, plurals or small words: "Tomates 1kg" → ["tomate"]. */
export function nameTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(new RegExp(SIZE.source, 'gi'), ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
    .map(singular);
}

export function nameKey(name: string): string {
  return nameTokens(name).join(' ');
}

/** A size printed in the name, e.g. "Huile 5L" → 5000 milli L. */
export function sizeFromName(name: string): { quantityMilli: number; unit: string } | null {
  const m = SIZE.exec(name);
  if (!m) return null;
  const [int, frac = ''] = m[1].replace(',', '.').split('.');
  const milli = Number(int) * 1000 + Number(frac.slice(0, 3).padEnd(3, '0'));
  if (!(milli > 0)) return null;
  return { quantityMilli: milli, unit: m[2].toLowerCase() };
}

/** 1000 for the same name (ignoring case, accents, plurals and sizes); else the matched length when every word of it is in the item's name; 0 when unrelated. */
function matchScore(item: string[], candidate: string): number {
  const words = nameTokens(candidate);
  if (words.length === 0) return 0;
  if (words.join(' ') === item.join(' ')) return 1000;
  return words.every((w) => item.includes(w)) ? words.join('').length : 0;
}

const SOURCE_RANK: Record<PriceSource, number> = { history: 1, mine: 1, starter: 0 };

/**
 * The reference that best matches an item name: the closest name wins; on a tie your purchases
 * and your own list beat the starter list, and between those two the more recent wins.
 */
export function findReference(name: string, refs: readonly PriceRef[]): PriceRef | null {
  const item = nameTokens(name);
  if (item.length === 0) return null;
  let best: { ref: PriceRef; score: number } | null = null;
  for (const ref of refs) {
    const score = Math.max(matchScore(item, ref.name), ...(ref.aliases ?? []).map((a) => matchScore(item, a)));
    if (score === 0) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        (SOURCE_RANK[ref.source] > SOURCE_RANK[best.ref.source] ||
          (SOURCE_RANK[ref.source] === SOURCE_RANK[best.ref.source] && (ref.date ?? '') > (best.ref.date ?? ''))))
    ) {
      best = { ref, score };
    }
  }
  return best?.ref ?? null;
}

// ---------------------------------------------------------------------------
// Usual cost of one line

export type EstimateLine = {
  lineKind: ItemLineKind;
  name: string;
  quantityMilli: number | null;
  unit: string | null;
  /** Null when no amount was entered (and none follows from quantity × price). */
  totalMinor: number | null;
  /** The total is an earlier estimate: it is estimated again. */
  estimated: boolean;
};

/** The quantity to price: the line's own when its unit fits the reference, else a size in its name, else the usual quantity. */
function quantityFor(line: Pick<EstimateLine, 'name' | 'quantityMilli' | 'unit'>, ref: PriceRef & { unit: string }) {
  const unit = line.unit?.trim() || null;
  if (line.quantityMilli !== null && line.quantityMilli > 0) {
    if (unit && areCompatible(unit, ref.unit)) return { milli: line.quantityMilli, unit };
    // A bare number counts in the reference's unit ("Tomatoes 2" → 2 kg).
    if (!unit) return { milli: line.quantityMilli, unit: ref.unit };
  }
  const size = sizeFromName(line.name);
  if (size && areCompatible(size.unit, ref.unit)) return { milli: size.quantityMilli, unit: size.unit };
  return { milli: ref.typicalMilli ?? 1000, unit: ref.unit };
}

/** What this line usually costs, in minor units. */
export function usualCost(line: Pick<EstimateLine, 'name' | 'quantityMilli' | 'unit'>, ref: PriceRef): number {
  if (ref.unit === null) return ref.priceMinor;
  const q = quantityFor(line, { ...ref, unit: ref.unit });
  const qtyMicro = normaliseQuantity(q.milli, q.unit)!;
  const perUnitMicro = normaliseQuantity(1000, ref.unit)!;
  return Math.round((ref.priceMinor * qtyMicro) / perUnitMicro);
}

// ---------------------------------------------------------------------------
// Splitting

/**
 * Splits `target` in proportion to `weights` (positive integers), exactly. Whole dirhams when the
 * amount is large enough, with the leftover centimes on the largest share.
 */
export function allocate(target: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const w = weights.some((x) => x > 0) ? weights.map((x) => Math.max(0, x)) : weights.map(() => 1);
  const sum = w.reduce((s, x) => s + x, 0);
  const step = target >= 200 * w.length ? 100 : 1;
  const units = Math.floor(target / step);
  const shares = w.map((x) => Math.floor((units * x) / sum));
  let left = units - shares.reduce((s, x) => s + x, 0);
  const byRemainder = w
    .map((x, i) => ({ i, r: ((units * x) % sum) / sum }))
    .sort((a, b) => b.r - a.r || w[b.i] - w[a.i] || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  const out = shares.map((s) => s * step);
  const largest = w.indexOf(Math.max(...w));
  out[largest] += target - units * step;
  return out;
}

export type LineEstimate = {
  index: number;
  totalMinor: number;
  /** Null when no reference matched: it got the median share. */
  ref: PriceRef | null;
  usualMinor: number | null;
};

export type EstimateResult =
  | {
      ok: true;
      lines: LineEstimate[];
      /** Indexes of "unallocated" lines whose amount the estimates now explain (to remove). */
      absorbed: number[];
      /** What is split: the amount paid minus every line that has a real amount. */
      targetMinor: number;
      /** Σ usual cost of the lines that matched a reference (null when none did). */
      usualMinor: number | null;
    }
  | { ok: false; reason: 'no-amount' | 'nothing-to-estimate' | 'already-covered' };

const signed = (l: EstimateLine) => (l.lineKind === 'discount' ? -(l.totalMinor ?? 0) : (l.totalMinor ?? 0));

/**
 * Proposes a total for every item line without an amount (or with an earlier estimate). "Unallocated"
 * lines are folded into what is split, since the estimated items are what they stood for.
 */
export function estimateItems(paidMinor: number | null, lines: EstimateLine[], refs: readonly PriceRef[]): EstimateResult {
  if (paidMinor === null || paidMinor <= 0) return { ok: false, reason: 'no-amount' };
  const targets = lines.flatMap((l, index) => (l.lineKind === 'product' && (l.totalMinor === null || l.estimated) ? [index] : []));
  if (targets.length === 0) return { ok: false, reason: 'nothing-to-estimate' };
  const absorbed = lines.flatMap((l, index) => (l.lineKind === 'unallocated' ? [index] : []));
  const known = lines.reduce((s, l, i) => (targets.includes(i) || absorbed.includes(i) ? s : s + signed(l)), 0);
  const targetMinor = paidMinor - known;
  if (targetMinor <= 0) return { ok: false, reason: 'already-covered' };

  const found = targets.map((index) => {
    const ref = findReference(lines[index].name, refs);
    return { index, ref, usual: ref ? usualCost(lines[index], ref) : null };
  });
  const usuals = found.flatMap((f) => (f.usual !== null && f.usual > 0 ? [f.usual] : [])).sort((a, b) => a - b);
  const median = usuals.length ? usuals[Math.floor((usuals.length - 1) / 2)] : 1;
  const shares = allocate(
    targetMinor,
    found.map((f) => (f.usual !== null && f.usual > 0 ? f.usual : median)),
  );
  return {
    ok: true,
    lines: found.map((f, i) => ({ index: f.index, totalMinor: shares[i], ref: f.ref, usualMinor: f.usual })),
    absorbed,
    targetMinor,
    usualMinor: usuals.length ? usuals.reduce((s, x) => s + x, 0) : null,
  };
}
