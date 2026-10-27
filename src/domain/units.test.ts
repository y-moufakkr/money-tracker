import { areCompatible, groupUnitLabel, normaliseQuantity, pricePerBaseUnit, unitGroup } from './units';

describe('unit normalisation', () => {
  it('groups compatible units and keeps others apart', () => {
    expect(unitGroup('kg')).toBe('mass');
    expect(unitGroup(' G ')).toBe('mass');
    expect(unitGroup('ml')).toBe('volume');
    expect(unitGroup('L')).toBe('volume');
    expect(unitGroup('dozen')).toBe('count');
    expect(unitGroup('pack')).toBe('unit:pack');
    expect(unitGroup(null)).toBe('none');
    expect(areCompatible('kg', 'g')).toBe(true);
    expect(areCompatible('L', 'ml')).toBe(true);
    expect(areCompatible('kg', 'L')).toBe(false);
    expect(areCompatible('pack', 'kg')).toBe(false);
    expect(areCompatible(null, null)).toBe(false);
    expect(groupUnitLabel('mass')).toBe('kg');
    expect(groupUnitLabel('unit:pack')).toBe('pack');
  });

  it('normalises quantities exactly in micro base units', () => {
    expect(normaliseQuantity(1500, 'kg')).toBe(1_500_000);
    expect(normaliseQuantity(500_000, 'g')).toBe(500_000); // 500 g = 0.5 kg
    expect(normaliseQuantity(250_000, 'ml')).toBe(250_000); // 250 ml = 0.25 L
    expect(normaliseQuantity(33_000, 'cl')).toBe(330_000); // 33 cl = 0.33 L
    expect(normaliseQuantity(1000, 'dozen')).toBe(12_000_000);
    expect(normaliseQuantity(null, 'kg')).toBeNull();
  });

  it('computes a price per base unit', () => {
    // 2 kg for 124 DH → 62 DH/kg; 500 g for 34 DH → 68 DH/kg.
    expect(pricePerBaseUnit(12_400, normaliseQuantity(2000, 'kg')!)).toBe(6_200);
    expect(pricePerBaseUnit(3_400, normaliseQuantity(500_000, 'g')!)).toBe(6_800);
    // 750 ml for 15 DH → 20 DH/L.
    expect(pricePerBaseUnit(1_500, normaliseQuantity(750_000, 'ml')!)).toBe(2_000);
  });
});
