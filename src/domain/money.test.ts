import {
  convertToBase,
  formatMoney,
  lineTotal,
  minorToInput,
  parseAmount,
  parseQuantity,
  parseRateMicros,
  parseSignedAmount,
  percentShares,
} from './money';

describe('parseAmount', () => {
  it.each([
    ['100', 10000],
    ['100.5', 10050],
    ['100,5', 10050],
    ['1,234.50', 123450],
    ['1.234,50', 123450],
    ['1 234,50', 123450],
    ['1,234', 123400],
    ['20,000', 2000000],
    ['0.01', 1],
    ['.5', 50],
    ['100 DH', 10000],
    ['12.345', 1234500],
  ])('%s → %d', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.234.5', '1.2.3', '-5', '1,23,4'])('rejects %s', (input) => {
    expect(parseAmount(input)).toBeNull();
  });

  it('supports zero-decimal currencies', () => {
    expect(parseAmount('500', 'JPY')).toBe(500);
    expect(parseAmount('5.5', 'JPY')).toBeNull();
  });

  it('parses signed amounts', () => {
    expect(parseSignedAmount('-100')).toBe(-10000);
    expect(parseSignedAmount('−12.5')).toBe(-1250);
  });
});

describe('formatMoney', () => {
  it('formats MAD with a suffix and thousands separators', () => {
    expect(formatMoney(2000000)).toBe('20,000 DH');
    expect(formatMoney(12350)).toBe('123.50 DH');
    expect(formatMoney(-10000)).toBe('−100 DH');
    expect(formatMoney(10000, 'MAD', { sign: 'always' })).toBe('+100 DH');
    expect(formatMoney(5, 'USD')).toBe('$0.05');
  });

  it('round-trips through the input format', () => {
    expect(minorToInput(12350)).toBe('123.50');
    expect(parseAmount(minorToInput(12350))).toBe(12350);
  });
});

describe('convertToBase', () => {
  const rates = new Map([['EUR', 10_850_000], ['JPY', 68_000]]);
  it('converts exactly and rounds half away from zero once', () => {
    expect(convertToBase(10000, 'EUR', rates)).toBe(108500);
    expect(convertToBase(1, 'EUR', rates)).toBe(11); // 0.1085 DH → 0.11 DH
    expect(convertToBase(-1, 'EUR', rates)).toBe(-11);
    expect(convertToBase(1000, 'JPY', rates)).toBe(6800);
  });
  it('returns null without a rate instead of guessing', () => {
    expect(convertToBase(100, 'USD', rates)).toBeNull();
    expect(convertToBase(100, 'MAD', rates)).toBe(100);
  });
  it('parses rates', () => {
    expect(parseRateMicros('10.85')).toBe(10_850_000);
    expect(parseRateMicros('0')).toBeNull();
  });
});

describe('quantities', () => {
  it('parses and multiplies without float drift', () => {
    expect(parseQuantity('2,5')).toBe(2500);
    expect(parseQuantity('0')).toBeNull();
    expect(lineTotal(1000, 2500)).toBe(2500); // 10 DH × 2.5 kg
    expect(lineTotal(699, 333)).toBe(233);
  });
});

describe('percentShares', () => {
  it('always sums to 100', () => {
    const shares = percentShares([20000, 15000, 5000, 800]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([49, 37, 12, 2]);
  });
  it('ignores negatives and empties', () => {
    expect(percentShares([])).toEqual([]);
    expect(percentShares([0, -5])).toEqual([0, 0]);
  });
});
