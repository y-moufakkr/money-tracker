/**
 * Money helpers. Every amount in the app is an integer number of minor units
 * (centimes for MAD). Floats are only used transiently when parsing user input.
 */

export const BASE_CURRENCY = 'MAD';

type CurrencyInfo = { decimals: number; symbol: string; suffix: boolean };

const CURRENCIES: Record<string, CurrencyInfo> = {
  MAD: { decimals: 2, symbol: 'DH', suffix: true },
  EUR: { decimals: 2, symbol: '€', suffix: true },
  USD: { decimals: 2, symbol: '$', suffix: false },
  GBP: { decimals: 2, symbol: '£', suffix: false },
  AED: { decimals: 2, symbol: 'AED', suffix: true },
  SAR: { decimals: 2, symbol: 'SAR', suffix: true },
  CAD: { decimals: 2, symbol: 'CA$', suffix: false },
  CHF: { decimals: 2, symbol: 'CHF', suffix: true },
  TRY: { decimals: 2, symbol: '₺', suffix: true },
  JPY: { decimals: 0, symbol: '¥', suffix: false },
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES);

export function currencyInfo(currency: string): CurrencyInfo {
  return CURRENCIES[currency] ?? { decimals: 2, symbol: currency, suffix: true };
}

/**
 * Parses user-typed amounts such as "100", "1,234.50", "1 234,5" or "12,5".
 * Returns minor units, or null when the text is not a valid non-negative amount.
 */
export function parseAmount(input: string, currency = BASE_CURRENCY): number | null {
  const { decimals } = currencyInfo(currency);
  const s = input.replace(/[\s  ]/g, '').replace(/(DH|MAD|dh)$/i, '');
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart: string;
  let fracPart = '';

  if (lastDot >= 0 && lastComma >= 0) {
    // Both separators: whichever comes last is the decimal separator.
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    const [i, f, ...rest] = s.split(dec);
    if (rest.length > 0) return null;
    intPart = i.split(thou).join('');
    fracPart = f;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    const last = parts[parts.length - 1];
    if (parts.length === 2 && last.length !== 3) {
      intPart = parts[0];
      fracPart = last;
    } else {
      // "1,234" or "1,234,567" style thousands grouping.
      if (parts.slice(1).some((p) => p.length !== 3)) return null;
      intPart = parts.join('');
    }
  } else {
    intPart = s;
  }

  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || (fracPart !== '' && !/^\d+$/.test(fracPart))) return null;
  if (fracPart.length > decimals) return null;

  const minor = BigInt(intPart) * BigInt(10 ** decimals) + BigInt((fracPart + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Formats minor units for display, e.g. 2000000 → "20,000 DH", 12350 → "123.50 DH". */
export function formatMoney(
  minor: number,
  currency = BASE_CURRENCY,
  opts: { sign?: 'auto' | 'always' | 'never'; decimals?: 'auto' | 'always'; symbol?: boolean } = {},
): string {
  const { decimals, symbol, suffix } = currencyInfo(currency);
  const sign = opts.sign ?? 'auto';
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const factor = 10 ** decimals;
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  let text = groupThousands(String(whole));
  if (decimals > 0 && (frac !== 0 || opts.decimals === 'always')) {
    text += '.' + String(frac).padStart(decimals, '0');
  }
  if (opts.symbol !== false) text = suffix ? `${text} ${symbol}` : `${symbol}${text}`;
  if (negative && sign !== 'never') return `−${text}`;
  if (!negative && minor !== 0 && sign === 'always') return `+${text}`;
  return text;
}

/** Plain editable representation (no grouping, no symbol), e.g. 12350 → "123.50". */
export function minorToInput(minor: number, currency = BASE_CURRENCY): string {
  const { decimals } = currencyInfo(currency);
  const abs = Math.abs(minor);
  const factor = 10 ** decimals;
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  const text = frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(decimals, '0')}`;
  return minor < 0 ? `-${text}` : text;
}

/** Like parseAmount but accepts a leading minus sign. */
export function parseSignedAmount(input: string, currency = BASE_CURRENCY): number | null {
  const trimmed = input.trim().replace(/^[−–]/, '-');
  if (trimmed.startsWith('-')) {
    const v = parseAmount(trimmed.slice(1), currency);
    return v === null ? null : -v;
  }
  return parseAmount(trimmed, currency);
}

/** Exchange rate stored as integer micros: base-currency units for one unit of `currency`, × 1e6. */
export type FxRate = { currency: string; rateMicros: number };

/**
 * Converts minor units of `from` into minor units of the base currency.
 * Returns null when no rate is known — callers must not guess.
 * Rounds half away from zero, once, at the end.
 */
export function convertToBase(minor: number, from: string, rates: Map<string, number>): number | null {
  if (from === BASE_CURRENCY) return minor;
  const rateMicros = rates.get(from);
  if (rateMicros === undefined) return null;
  const fromDec = currencyInfo(from).decimals;
  const baseDec = currencyInfo(BASE_CURRENCY).decimals;
  // minor_base = minor_from / 10^fromDec * rate * 10^baseDec, done in BigInt to stay exact.
  const num = BigInt(minor) * BigInt(rateMicros) * 10n ** BigInt(baseDec);
  const den = 1_000_000n * 10n ** BigInt(fromDec);
  const q = num / den;
  const r = num % den;
  const roundUp = (r < 0n ? -r : r) * 2n >= den;
  return Number(roundUp ? q + (num < 0n ? -1n : 1n) : q);
}

/** Parses a user-typed decimal rate ("10.85") into micros. */
export function parseRateMicros(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  const micros = Number(i) * 1_000_000 + Number((f + '000000').slice(0, 6));
  return micros > 0 ? micros : null;
}

export function formatRate(micros: number): string {
  return (micros / 1_000_000).toFixed(6).replace(/\.?0+$/, '');
}

/** Quantities are stored in thousandths: 2.5 kg → 2500. */
export function parseQuantity(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  const milli = Number(i) * 1000 + Number((f + '000').slice(0, 3));
  return milli > 0 ? milli : null;
}

export function formatQuantity(milli: number): string {
  return (milli / 1000).toFixed(3).replace(/\.?0+$/, '');
}

/** unit price × quantity, rounded to the nearest minor unit. */
export function lineTotal(unitPriceMinor: number, quantityMilli: number): number {
  return Math.round((unitPriceMinor * quantityMilli) / 1000);
}

/** Splits a total into percentage shares (0–100) that always sum to 100 for non-empty input. */
export function percentShares(values: number[]): number[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) / total) * 100);
  const floored = raw.map(Math.floor);
  let remainder = 100 - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    if (raw[i] > 0) {
      floored[i] += 1;
      remainder -= 1;
    }
  }
  return floored;
}
