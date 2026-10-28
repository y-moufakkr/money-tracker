import { PRICE_BOOK } from './price-book';
import {
  allocate,
  estimateItems,
  findReference,
  nameTokens,
  sizeFromName,
  STARTER_REFS,
  usualCost,
  type EstimateLine,
  type PriceRef,
} from './price-estimate';

const item = (name: string, extra: Partial<EstimateLine> = {}): EstimateLine => ({
  lineKind: 'product',
  name,
  quantityMilli: null,
  unit: null,
  totalMinor: null,
  estimated: false,
  ...extra,
});

const ref = (name: string, unit: string | null, priceMinor: number, extra: Partial<PriceRef> = {}): PriceRef => ({
  name,
  unit,
  priceMinor,
  typicalMilli: null,
  source: 'mine',
  date: '2026-10-01',
  ...extra,
});

describe('starter price list', () => {
  it('has whole-centime prices, usual quantities and distinct names', () => {
    for (const e of PRICE_BOOK) {
      expect(Number.isSafeInteger(e.priceMinor) && e.priceMinor > 0).toBe(true);
      expect(Number.isSafeInteger(e.typicalMilli) && e.typicalMilli > 0).toBe(true);
    }
    const names = PRICE_BOOK.map((e) => nameTokens(e.name).join(' '));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('names', () => {
  it('ignores case, accents, plurals, sizes and small words', () => {
    expect(nameTokens('Tomates 1kg')).toEqual(['tomate']);
    expect(nameTokens('Pommes de terre')).toEqual(['pomme', 'terre']);
    expect(nameTokens('Strawberries')).toEqual(['strawberry']);
    expect(nameTokens('Thé vert')).toEqual(['the', 'vert']);
  });

  it('reads a size printed in the name', () => {
    expect(sizeFromName('Huile Lesieur 5L')).toEqual({ quantityMilli: 5000, unit: 'l' });
    expect(sizeFromName('Lait 0,5 L')).toEqual({ quantityMilli: 500, unit: 'l' });
    expect(sizeFromName('Farine 500g')).toEqual({ quantityMilli: 500_000, unit: 'g' });
    expect(sizeFromName('Tomatoes')).toBeNull();
  });

  it('finds starter items by French, Darija or English names', () => {
    expect(findReference('Tomates', STARTER_REFS)?.name).toBe('Tomatoes');
    expect(findReference('matecha', STARTER_REFS)?.name).toBe('Tomatoes');
    expect(findReference('Poulet', STARTER_REFS)?.name).toBe('Chicken');
    expect(findReference('Lait Centrale 1L', STARTER_REFS)?.name).toBe('Milk');
    expect(findReference('Pommes de terre', STARTER_REFS)?.name).toBe('Potatoes');
    expect(findReference('Pain de sucre', STARTER_REFS)?.name).toBe('Sugar loaf');
    expect(findReference('Viande hachée', STARTER_REFS)?.name).toBe('Minced meat');
    expect(findReference('Printer ink', STARTER_REFS)).toBeNull();
  });

  it('prefers your prices over the starter list, and the more recent of yours', () => {
    const learned = ref('Tomates', 'kg', 650, { source: 'history', date: '2026-10-20' });
    const mine = ref('Tomates', 'kg', 900, { source: 'mine', date: '2026-09-01' });
    expect(findReference('tomates', [...STARTER_REFS, mine])).toBe(mine);
    expect(findReference('tomates', [...STARTER_REFS, mine, learned])).toBe(learned);
    // A closer name still wins over a more trusted source.
    expect(findReference('Tomates cerises', [ref('Tomates cerises', 'kg', 2500, { source: 'starter' }), learned])?.priceMinor).toBe(2500);
  });
});

describe('usual cost of a line', () => {
  const tomatoes = ref('Tomatoes', 'kg', 800, { typicalMilli: 1000 });

  it('uses the line quantity in any compatible unit', () => {
    expect(usualCost(item('Tomatoes', { quantityMilli: 2000, unit: 'kg' }), tomatoes)).toBe(1600);
    expect(usualCost(item('Tomatoes', { quantityMilli: 500_000, unit: 'g' }), tomatoes)).toBe(400);
    // A bare number counts in the reference's unit.
    expect(usualCost(item('Tomatoes', { quantityMilli: 3000 }), tomatoes)).toBe(2400);
  });

  it('falls back to a size in the name, then the usual quantity', () => {
    const oil = ref('Huile', 'L', 1900, { typicalMilli: 1000 });
    expect(usualCost(item('Huile 5L'), oil)).toBe(9500);
    expect(usualCost(item('Huile'), oil)).toBe(1900);
    // An incompatible unit is not converted by guessing.
    expect(usualCost(item('Tomatoes', { quantityMilli: 2000, unit: 'pack' }), tomatoes)).toBe(800);
  });

  it('uses a per-purchase amount as is', () => {
    expect(usualCost(item('Légumes', { quantityMilli: 3000, unit: 'kg' }), ref('Légumes', null, 3500))).toBe(3500);
  });
});

describe('allocate', () => {
  it('always adds up to the target exactly', () => {
    for (const [target, weights] of [
      [10_000, [800, 1100, 2200]],
      [23_747, [1, 1, 1]],
      [7, [5, 3, 1]],
      [100, [0, 0]],
      [999_999, [123, 456, 789, 1]],
    ] as [number, number[]][]) {
      const out = allocate(target, weights);
      expect(out.reduce((s, x) => s + x, 0)).toBe(target);
      expect(out.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    }
  });

  it('splits in proportion, in whole dirhams with the centimes on the largest share', () => {
    expect(allocate(10_050, [1000, 3000])).toEqual([2500, 7550]);
    expect(allocate(300, [1, 1, 1])).toEqual([100, 100, 100]);
  });
});

describe('estimateItems', () => {
  const refs = [
    ref('Tomatoes', 'kg', 800, { typicalMilli: 1000 }),
    ref('Chicken', 'kg', 2200, { typicalMilli: 1500 }),
    ref('Bread', 'piece', 150, { typicalMilli: 4000 }),
  ];

  it('splits what the priced lines leave of the amount paid, by usual cost', () => {
    const lines = [item('Tomatoes', { quantityMilli: 2000, unit: 'kg' }), item('Chicken'), item('Milk', { totalMinor: 700 })];
    const r = estimateItems(5700, lines, refs);
    if (!r.ok) throw new Error(r.reason);
    // 57 − 7 (milk) = 50 DH split 16 : 33 (2 kg tomatoes, 1.5 kg chicken).
    expect(r.targetMinor).toBe(5000);
    expect(r.usualMinor).toBe(4900);
    expect(r.lines.map((l) => [l.index, l.totalMinor])).toEqual([
      [0, 1600],
      [1, 3400],
    ]);
  });

  it('gives an unknown item the median share and keeps the sum exact', () => {
    const lines = [item('Tomatoes'), item('Bread'), item('Mystery thing'), item('Chicken')];
    const r = estimateItems(10_000, lines, refs);
    if (!r.ok) throw new Error(r.reason);
    expect(r.lines.find((l) => l.index === 2)?.ref).toBeNull();
    expect(r.lines.reduce((s, l) => s + l.totalMinor, 0)).toBe(10_000);
  });

  it('splits equally when nothing is known', () => {
    const r = estimateItems(900, [item('A'), item('B'), item('C')], []);
    if (!r.ok) throw new Error(r.reason);
    expect(r.lines.map((l) => l.totalMinor)).toEqual([300, 300, 300]);
    expect(r.usualMinor).toBeNull();
  });

  it('counts discounts and charges, re-estimates earlier estimates and folds in "unallocated" lines', () => {
    const lines: EstimateLine[] = [
      item('Tomatoes', { totalMinor: 999, estimated: true }),
      item('Chicken'),
      { ...item('Remise'), lineKind: 'discount', totalMinor: 500 },
      { ...item('Sac'), lineKind: 'charge', totalMinor: 100 },
      { ...item('Not read'), lineKind: 'unallocated', totalMinor: 2000 },
    ];
    const r = estimateItems(4600, lines, refs);
    if (!r.ok) throw new Error(r.reason);
    // 46 + 5 − 1 = 50 DH for the two items; the unallocated line is replaced.
    expect(r.targetMinor).toBe(5000);
    expect(r.absorbed).toEqual([4]);
    expect(r.lines.map((l) => l.index)).toEqual([0, 1]);
  });

  it('says why nothing can be estimated', () => {
    expect(estimateItems(null, [item('Tomatoes')], refs)).toEqual({ ok: false, reason: 'no-amount' });
    expect(estimateItems(1000, [item('Tomatoes', { totalMinor: 1000 })], refs)).toEqual({ ok: false, reason: 'nothing-to-estimate' });
    expect(estimateItems(1000, [item('Tomatoes'), item('Milk', { totalMinor: 1000 })], refs)).toEqual({
      ok: false,
      reason: 'already-covered',
    });
  });
});
