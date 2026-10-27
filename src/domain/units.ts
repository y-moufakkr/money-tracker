/**
 * Unit normalisation for product price comparisons. Quantities are only
 * compared when their units measure the same thing (kg ↔ g, L ↔ ml,
 * piece ↔ dozen). Anything else (pack, bottle, box, no unit) stays in its
 * own group: we never guess how much a "pack" weighs.
 *
 * Normalised quantities are integers in micro base units (1 kg = 1,000,000),
 * so the maths stays exact.
 */

export type Dimension = 'mass' | 'volume' | 'count';

/** Group key: a dimension, `unit:<name>` for an incomparable unit, or `none` when no unit was recorded. */
export type UnitGroup = Dimension | `unit:${string}` | 'none';

/** Micro base units per one recorded unit. */
const UNITS: Record<string, { dimension: Dimension; micro: number }> = {
  kg: { dimension: 'mass', micro: 1_000_000 },
  kgs: { dimension: 'mass', micro: 1_000_000 },
  kilo: { dimension: 'mass', micro: 1_000_000 },
  kilos: { dimension: 'mass', micro: 1_000_000 },
  g: { dimension: 'mass', micro: 1_000 },
  gr: { dimension: 'mass', micro: 1_000 },
  gram: { dimension: 'mass', micro: 1_000 },
  grams: { dimension: 'mass', micro: 1_000 },
  l: { dimension: 'volume', micro: 1_000_000 },
  litre: { dimension: 'volume', micro: 1_000_000 },
  liter: { dimension: 'volume', micro: 1_000_000 },
  cl: { dimension: 'volume', micro: 10_000 },
  ml: { dimension: 'volume', micro: 1_000 },
  piece: { dimension: 'count', micro: 1_000_000 },
  pieces: { dimension: 'count', micro: 1_000_000 },
  pc: { dimension: 'count', micro: 1_000_000 },
  pcs: { dimension: 'count', micro: 1_000_000 },
  unit: { dimension: 'count', micro: 1_000_000 },
  dozen: { dimension: 'count', micro: 12_000_000 },
};

export const BASE_UNIT_LABEL: Record<Dimension, string> = { mass: 'kg', volume: 'L', count: 'piece' };

export function unitGroup(unit: string | null | undefined): UnitGroup {
  const u = unit?.trim().toLowerCase();
  if (!u) return 'none';
  const known = UNITS[u];
  return known ? known.dimension : `unit:${u}`;
}

/** Label used after a normalised price, e.g. "kg" in "62 DH/kg". */
export function groupUnitLabel(group: UnitGroup): string | null {
  if (group === 'none') return null;
  if (group.startsWith('unit:')) return group.slice(5);
  return BASE_UNIT_LABEL[group as Dimension];
}

/**
 * Quantity in micro base units for comparable units; for an incomparable
 * unit, micro units of that same unit. Null when there is no quantity.
 */
export function normaliseQuantity(quantityMilli: number | null, unit: string | null | undefined): number | null {
  if (quantityMilli === null || quantityMilli <= 0) return null;
  const u = unit?.trim().toLowerCase();
  const known = u ? UNITS[u] : undefined;
  return known ? (quantityMilli * known.micro) / 1000 : quantityMilli * 1000;
}

/** Price in minor units per one base unit (kg, L, piece), rounded once. */
export function pricePerBaseUnit(totalMinor: number, quantityMicro: number): number {
  return Math.round((totalMinor * 1_000_000) / quantityMicro);
}

/** "12.5" for 12,500,000 micro units. */
export function formatNormalisedQuantity(micro: number): string {
  return (Math.round(micro / 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
}

export function areCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const ga = unitGroup(a);
  return ga !== 'none' && ga === unitGroup(b);
}
