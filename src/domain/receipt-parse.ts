/**
 * Receipt text → a draft expense (Phase 5). Pure: OCR lines in, proposed fields out.
 *
 * The rule is the same as everywhere else in the app: never invent a value. A field is only
 * proposed when it is printed on the receipt and recognised with some confidence; each proposal
 * says how sure it is and which printed text it came from, so the form can ask the user to check
 * it. The user always confirms before anything is saved.
 *
 * Amounts are converted to minor units only through `parseAmount` (domain/money.ts).
 */
import { addDays, isValidISODate } from './dates';
import { BASE_CURRENCY, formatMoney, lineTotal, parseAmount, parseQuantity } from './money';
import type { ItemLineKind } from './types';

export type OcrBox = { x: number; y: number; width: number; height: number };

/** One recognised line. Boxes (image pixels, top-left origin) let lines on the same row be joined. */
export type OcrLine = { text: string; confidence?: number | null; box?: OcrBox | null };

/** What the OCR module returns for one photo (also the format of the receipt fixtures). */
export type OcrResult = { width: number | null; height: number | null; lines: OcrLine[] };

export type Confidence = 'high' | 'medium' | 'low';

export type Field<T> = {
  value: T;
  confidence: Confidence;
  /** The printed text the value was read from (null when nothing was printed, e.g. today's date). */
  source: string | null;
};

export type ReceiptItem = {
  lineKind: ItemLineKind;
  name: string;
  quantityMilli: number | null;
  unit: string | null;
  unitPriceMinor: number | null;
  /** Always positive; a discount reduces the receipt. */
  totalMinor: number;
  /** How sure this one line is (row OCR, quantity × price agreeing with the total, name quality). */
  confidence: Confidence;
  /** The printed row(s) the line was read from; null for the "not read" line. */
  source: string | null;
  /** An existing product with this name (the item is renamed to it so no product is duplicated). */
  productId: string | null;
  /** That product's usual category. */
  categoryId: string | null;
};

export type ReceiptParse = {
  /** The printed total of the lines (TOTAL, TOTAL TTC…), before a global discount, rounding or stamp duty. */
  totalMinor?: Field<number>;
  /** What actually left the account (NET A PAYER, A PAYER, MONTANT TTC…) when printed apart from the total. */
  finalMinor?: Field<number>;
  /** Always set: the printed date, or today (low confidence) when none was found. */
  date: Field<string>;
  merchantName?: Field<string> & { merchantId: string | null };
  /**
   * The lines read, plus one `unallocated` line for the part of the amount no line was read for,
   * so the lines always add up to the amount. Left out when the lines add up to more than it.
   */
  items?: Field<ReceiptItem[]>;
  /** The amount of that `unallocated` line (0 when every dirham was matched to a line). */
  unreadMinor?: number;
  /** The most common usual category of the matched products (for the expense, after the merchant's). */
  productCategoryId?: string | null;
  warnings: string[];
};

export type ParseContext = {
  /** YYYY-MM-DD in the app's calendar. */
  today: string;
  /** Existing merchants, matched accent- and case-insensitively so they are reused. */
  merchants?: { id: string; name: string }[];
  /** Existing products, matched the same way, with their usual category. */
  products?: { id: string; name: string; categoryId: string | null }[];
  currency?: string;
};

/** Name of the line that holds the part of the amount no printed line was read for. */
export const UNREAD_ITEM_NAME = 'Not read from the receipt';

/** The expense amount: what was paid when printed, otherwise the total. */
export function receiptAmount(p: ReceiptParse): Field<number> | undefined {
  return p.finalMinor ?? p.totalMinor;
}

// ---------------------------------------------------------------------------
// Text helpers

/** Upper case, accents removed, single spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Lower case, accents and punctuation removed: the key used to compare merchant names. */
export function merchantKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type Row = {
  text: string;
  norm: string;
  confidence: number | null;
  height: number | null;
  /** Vertical band of the row (image pixels), when the lines have boxes. */
  top: number | null;
  bottom: number | null;
  parts: OcrLine[];
};

/**
 * Joins lines printed on the same row (a label on the left, its amount on the right) when every
 * line has a box; otherwise keeps the lines in the order given.
 */
export function toRows(lines: (OcrLine | string)[]): Row[] {
  const ls: OcrLine[] = lines
    .map((l) => (typeof l === 'string' ? { text: l } : l))
    .filter((l) => l.text.trim() !== '');
  const row = (parts: OcrLine[]): Row => {
    const text = parts.map((p) => p.text.trim()).join(' ');
    const confs = parts.map((p) => p.confidence).filter((c): c is number => typeof c === 'number' && c > 0);
    const heights = parts.map((p) => p.box?.height).filter((h): h is number => typeof h === 'number');
    const boxed = parts.every((p) => p.box);
    return {
      text,
      norm: normalizeText(text),
      confidence: confs.length ? Math.min(...confs) : null,
      height: heights.length ? Math.max(...heights) : null,
      top: boxed ? Math.min(...parts.map((p) => p.box!.y)) : null,
      bottom: boxed ? Math.max(...parts.map((p) => p.box!.y + p.box!.height)) : null,
      parts,
    };
  };
  if (!ls.length || !ls.every((l) => l.box && l.box.height > 0)) return ls.map((l) => row([l]));

  const sorted = [...ls].sort((a, b) => a.box!.y + a.box!.height / 2 - (b.box!.y + b.box!.height / 2));
  const groups: { top: number; bottom: number; parts: OcrLine[] }[] = [];
  for (const l of sorted) {
    const b = l.box!;
    const mid = b.y + b.height / 2;
    const g = groups[groups.length - 1];
    // Same row: this line's middle falls inside the row's band.
    if (g && mid >= g.top && mid <= g.bottom) {
      g.parts.push(l);
      g.top = Math.min(g.top, b.y);
      g.bottom = Math.max(g.bottom, b.y + b.height);
    } else {
      groups.push({ top: b.y, bottom: b.y + b.height, parts: [l] });
    }
  }
  return groups.map((g) => row(g.parts.sort((a, b) => a.box!.x - b.box!.x)));
}

// ---------------------------------------------------------------------------
// Amounts

type AmountToken = { minor: number; negative: boolean; text: string; index: number; end: number };

// 1 234,50 · 1.234,50 · 1,234.50 · 1234.50 · 12,850 (3 decimals, fuel prices); not part of a date.
const DECIMAL_AMOUNT = /(^|[^\d.,/])(-\s?)?(\d{1,3}(?:[  .,]\d{3})+|\d+)[.,](\d{2,3})(?![.,]?\d)/g;
// Whole amounts only count when a currency follows: "125 DH".
const WHOLE_AMOUNT = /(^|[^\d.,/])(\d{1,3}(?:[  .]\d{3})+|\d+)\s?(?:DH|DHS|MAD|DIRHAMS?)\b/gi;

/** Amounts printed in a row, left to right. Three-decimal values (unit prices) are kept only when exact in centimes. */
export function findAmounts(text: string, currency = BASE_CURRENCY): AmountToken[] {
  const out: AmountToken[] = [];
  for (const m of text.matchAll(DECIMAL_AMOUNT)) {
    let dec = m[4];
    if (dec.length === 3) {
      if (!dec.endsWith('0')) continue;
      dec = dec.slice(0, 2);
    }
    const minor = parseAmount(`${m[3].replace(/[  .,]/g, '')}.${dec}`, currency);
    if (minor === null) continue;
    const index = m.index + m[1].length;
    out.push({ minor, negative: !!m[2], text: m[0].slice(m[1].length).trim(), index, end: m.index + m[0].length });
  }
  for (const m of text.matchAll(WHOLE_AMOUNT)) {
    const index = m.index + m[1].length;
    if (out.some((t) => index >= t.index && index < t.end)) continue;
    const minor = parseAmount(m[2].replace(/[  .]/g, ''), currency);
    if (minor === null) continue;
    out.push({ minor, negative: false, text: m[0].slice(m[1].length).trim(), index, end: m.index + m[0].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Total

/**
 * `final` labels name what was paid (after a global discount, rounding or stamp duty); `total`
 * labels name the total of the lines. A receipt often prints only one of them.
 */
type LabelKind = 'total' | 'final';
const TOTAL_LABELS: { re: RegExp; rank: number; kind: LabelKind }[] = [
  { re: /\bNET\s*A\s*PAYER\b/, rank: 5, kind: 'final' },
  { re: /\b(TOTAL|MONTANT|SOMME|RESTE)?\s*A\s*PAYER\b/, rank: 5, kind: 'final' },
  { re: /\bMONTANT\s*T\.?T\.?C\b/, rank: 4, kind: 'final' },
  { re: /\bTOTAL\s*NET\b/, rank: 4, kind: 'final' },
  { re: /\bTOTAL\s*T\.?T\.?C\b/, rank: 4, kind: 'total' },
  { re: /\bTOTAL\s*GENERAL\b/, rank: 4, kind: 'total' },
  { re: /\bT\.?T\.?C\b/, rank: 3, kind: 'total' },
  { re: /\bTOTAL\b/, rank: 3, kind: 'total' },
  { re: /\bMONTANT\b/, rank: 3, kind: 'total' },
];

/** Rows that carry an amount but are never the total paid. */
const NOT_TOTAL =
  /\bH\.?T\b|HORS\s*TAXE|\bT\.?V\.?A\b|\bTAXE|REMISE|REDUCTION|PROMO|\bRENDU|MONNAIE|ESPECE|\bESP\b|\bCB\b|CARTE|VISA|MASTERCARD|\bCASH\b|CHEQUE|ECONOMI|FIDELIT|POINTS|SOUS[\s-]*TOTAL|S\/\s*TOTAL|\bNB\.?\s*ART|NOMBRE|NBRE|\bQTE\b|QUANTITE|TIMBRE|AVOIR|ARRONDI/;

const CASH_GIVEN = /ESPECE|\bESP\b|\bCASH\b|\bRECU\b/;
const CHANGE = /\bRENDU|MONNAIE/;
const CARD = /\bCB\b|CARTE|VISA|MASTERCARD|\bTPE\b/;

type TotalCandidate = { minor: number; rank: number; kind: LabelKind; row: number; source: string; confidence: number | null };

/** "TOTAL TTC DONT TVA": what follows "dont" (of which) is a part of the total, not another line. */
const DONT = /\bDONT\b.*$/;
/** "Dont" as OCR reads it ("NONT DROITS DE TIMBRE"). */
const DONT_SLIP = /\b[DN]ONT\b/;

/** "T O T A L" read as "TOTA L": joins runs of short words when one of them is a single letter. */
function joinSpacedLetters(norm: string): string {
  return norm.replace(/\b[A-Z]{1,4}(?: [A-Z]{1,4})+\b/g, (m) => (/\b[A-Z]\b/.test(m) ? m.replace(/ /g, '') : m));
}

function totalLabel(norm: string): { rank: number; kind: LabelKind } | null {
  const label = norm.replace(DONT, '');
  const joined = joinSpacedLetters(label);
  if (NOT_TOTAL.test(label) || NOT_TOTAL.test(joined)) return null;
  for (const text of [label, joined]) for (const l of TOTAL_LABELS) if (l.re.test(text)) return l;
  return null;
}

const lettersIn = (s: string) => (s.match(/[A-Z]/g) ?? []).length;

/** An amount alone in this text (the label was printed elsewhere). */
function loneAmount(text: string, currency: string): AmountToken | null {
  const amounts = findAmounts(text, currency);
  if (amounts.length !== 1) return null;
  const rest = normalizeText(text).replace(normalizeText(amounts[0].text), '').replace(/\b(DH|DHS|MAD)\b/g, '');
  return lettersIn(rest) === 0 ? amounts[0] : null;
}

/**
 * A total printed larger than its label sits a little lower, so OCR puts it on the next row:
 * an amount on its own whose box starts within the label's row.
 */
function besideAmount(label: Row, next: Row, currency: string): AmountToken | null {
  if (label.top === null || label.bottom === null) return null;
  const end = label.bottom - 0.2 * (label.bottom - label.top);
  for (const p of next.parts) {
    if (!p.box || p.box.y < label.top || p.box.y >= end) continue;
    const a = loneAmount(p.text, currency);
    if (a) return a;
  }
  return null;
}

/** Rows with this many amounts are tax tables (HT, TVA, TTC columns), not the amount paid. */
const TABLE_AMOUNTS = 3;

function findTotal(rows: Row[], currency: string) {
  const candidates: TotalCandidate[] = [];
  rows.forEach((r, i) => {
    const label = totalLabel(r.norm);
    if (!label) return;
    const amounts = findAmounts(r.text, currency).filter((a) => !a.negative && a.minor > 0);
    if (amounts.length >= TABLE_AMOUNTS) return;
    if (amounts.length) {
      // With "dont TVA …" on the row, the total is the larger amount; otherwise the last one.
      const a = DONT.test(r.norm) ? amounts.reduce((m, x) => (x.minor > m.minor ? x : m)) : amounts[amounts.length - 1];
      candidates.push({ minor: a.minor, ...label, row: i, source: r.text, confidence: r.confidence });
    } else if (rows[i + 1]) {
      const next = rows[i + 1];
      const a = loneAmount(next.text, currency) ?? besideAmount(r, next, currency);
      if (a && a.minor > 0) {
        candidates.push({ minor: a.minor, ...label, row: i, source: `${r.text} ${next.text}`, confidence: next.confidence });
      }
    }
  });
  return candidates;
}

/** The bottom candidate of the highest rank, and whether the others of that rank disagree with it. */
function pickCandidate(cands: TotalCandidate[]) {
  if (!cands.length) return null;
  const top = Math.max(...cands.map((c) => c.rank));
  const best = cands.filter((c) => c.rank === top);
  return { pick: best[best.length - 1], conflict: new Set(best.map((c) => c.minor)).size > 1 };
}

/** What the payment lines say was paid: cash given − change, or the card amount. */
function paymentEvidence(rows: Row[], currency: string) {
  const firstAmount = (re: RegExp, exclude?: RegExp) => {
    for (const r of rows) {
      if (!re.test(r.norm) || (exclude && exclude.test(r.norm))) continue;
      const a = findAmounts(r.text, currency).filter((x) => !x.negative);
      if (a.length) return { minor: a[a.length - 1].minor, source: r.text };
    }
    return null;
  };
  const given = firstAmount(CASH_GIVEN, CHANGE);
  const change = firstAmount(CHANGE);
  const card = firstAmount(CARD, /\bTOTAL\b/);
  const cash = given && change && given.minor >= change.minor ? given.minor - change.minor : null;
  return { cash, card: card?.minor ?? null, cardSource: card?.source ?? null, given: given?.minor ?? null };
}

/** Lines between the total and the amount paid that change it. */
type Adjustment = { kind: 'discount' | 'charge'; name: string; minor: number; source: string; confidence: number | null };

const ROUNDING = /ARRONDI/;
const STAMP = /TIMBRE/;
const SERVICE = /\bSERVICE\b|POURBOIRE|\bFRAIS\b/;

/**
 * A global discount, rounding, stamp duty or service line in rows [from, to). Lines saying
 * "dont" (of which) are part of the total, not added to it, and are skipped here.
 */
function findAdjustments(rows: Row[], from: number, to: number, currency: string): Adjustment[] {
  const out: Adjustment[] = [];
  for (let i = from; i < to; i++) {
    const r = rows[i];
    if (DONT_SLIP.test(r.norm)) continue;
    const kind = DISCOUNT.test(r.norm) ? 'discount' : ROUNDING.test(r.norm) || STAMP.test(r.norm) || SERVICE.test(r.norm) ? 'charge' : null;
    if (!kind) continue;
    const amounts = findAmounts(r.text, currency);
    const a = amounts[amounts.length - 1];
    if (!a || a.minor === 0) continue;
    // Rounding goes either way: printed negative, it lowers what is paid.
    const k = kind === 'charge' && ROUNDING.test(r.norm) && a.negative ? 'discount' : kind;
    out.push({ kind: k, name: cleanItemName(r.text.slice(0, a.index)) || (k === 'discount' ? 'Remise' : 'Frais'), minor: a.minor, source: r.text, confidence: r.confidence });
  }
  return out;
}

const signedSum = (lines: { lineKind: ItemLineKind; totalMinor: number }[]) =>
  lines.reduce((s, l) => s + (l.lineKind === 'discount' ? -l.totalMinor : l.totalMinor), 0);

const LOWER: Record<Confidence, Confidence> = { high: 'medium', medium: 'low', low: 'low' };
const RAISE: Record<Confidence, Confidence> = { high: 'high', medium: 'high', low: 'medium' };
const RANK: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };
const weakest = (cs: Confidence[]): Confidence => cs.reduce((m, c) => (RANK[c] < RANK[m] ? c : m), 'high' as Confidence);

/** OCR confidence below this lowers a field by one level. */
const WEAK_OCR = 0.6;

// ---------------------------------------------------------------------------
// Date

const DMY = /(^|[^\d/.-])(\d{1,2})\s?[/.-]\s?(\d{1,2})\s?[/.-]\s?(\d{4}|\d{2})(?![\d/.-]?\d)/g;
const YMD = /(^|[^\d/.-])(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?![\d/.-]?\d)/g;
// Moroccan numbers: 05xx / 06xx / 07xx / 08xx or +212, in pairs or not.
const PHONE = /\b(TEL|FAX|GSM|PORTABLE|MOBILE)\b|(?:\+212\s?|\b0)[5-8](?:[\s.-]?\d){8}\b/;

/** Older than this, a printed date is treated as misread. */
const MAX_AGE_DAYS = 730;
/** Up to this age a date is plausible enough to propose with high confidence. */
const RECENT_DAYS = 90;

function iso(y: number, m: number, d: number): string | null {
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidISODate(s) ? s : null;
}

// Dates glued to a ticket number or a time ("N°004225/10/2026", "25/10/202614:32"): two-digit day
// and month, the same separator twice. Only tried when a row has no date with clear edges.
const DMY_GLUED = /(\d{2})([/.-])(\d{2})\2(20\d{2}|\d{2})/g;

const MONTH = '(JANVIER|JANV|JANUARY|JAN|FEVRIER|FEVR|FEV|FEBRUARY|FEB|MARS|MARCH|MAR|AVRIL|AVR|APRIL|APR|MAI|MAY|JUIN|JUNE|JUN|JUILLET|JUIL|JULY|JUL|AOUT|AUGUST|AUG|SEPTEMBRE|SEPTEMBER|SEPT|SEP|OCTOBRE|OCTOBER|OCT|NOVEMBRE|NOVEMBER|NOV|DECEMBRE|DECEMBER|DEC)(?![A-Z])';
// "25 OCT 2026", "25 octobre 2026", "1er mai 26", "25-OCT-2026" (on normalised text).
const DAY_MONTH = new RegExp(`(?:^|[^\\d])(\\d{1,2})(?:ER|ST|ND|RD|TH)?[\\s./-]*${MONTH}\\.?[\\s./,-]*(\\d{4}|\\d{2})(?![\\d])`, 'g');
// "OCT 25, 2026"
const MONTH_DAY = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:ST|ND|RD|TH)?,?\\s+(\\d{4})(?![\\d])`, 'g');

function monthNumber(word: string): number {
  if (word.startsWith('JUIL') || word.startsWith('JUL')) return 7;
  if (word.startsWith('JUI') || word.startsWith('JUN')) return 6;
  const p = word.slice(0, 3);
  const n = { JAN: 1, FEV: 2, FEB: 2, MAR: 3, AVR: 4, APR: 4, MAI: 5, MAY: 5, AOU: 8, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }[p];
  return n ?? 0;
}

const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * OCR slips inside digit groups only: O read for 0 and l/I/| for 1, in tokens made of digits and
 * date/time separators that hold at least one real digit ("27/1O/2026"). Words are never changed.
 */
function fixDigitSlips(text: string): string {
  return text.replace(/(?<![A-Za-z])[0-9OoIl|/.:-]+(?![A-Za-z])/g, (tok) =>
    /\d/.test(tok) && /[0-9OoIl|]{2}/.test(tok) ? tok.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1') : tok,
  );
}

function findDate(rows: Row[], today: string, warnings: string[]): Field<string> {
  const found: { date: string; row: number; labelled: boolean; source: string; confidence: number | null; unsure: boolean }[] = [];
  let future = false;
  let old = false;
  rows.forEach((r, i) => {
    if (PHONE.test(r.norm) && !/\bDATE\b/.test(r.norm)) return;
    let inRow = 0;
    const add = (date: string | null, unsure: boolean) => {
      if (!date) return;
      inRow++;
      if (date > today) return void (future = true);
      if (date < addDays(today, -MAX_AGE_DAYS)) return void (old = true);
      found.push({ date, row: i, labelled: /\bDATE\b|\bLE\b/.test(r.norm), source: r.text, confidence: r.confidence, unsure });
    };
    const scan = (text: string, unsure: boolean) => {
      const norm = normalizeText(text);
      for (const m of text.matchAll(DMY)) add(iso(year(m[4]), Number(m[3]), Number(m[2])), unsure);
      for (const m of text.matchAll(YMD)) add(iso(Number(m[2]), Number(m[3]), Number(m[4])), unsure);
      for (const m of norm.matchAll(DAY_MONTH)) add(iso(year(m[3]), monthNumber(m[2]), Number(m[1])), unsure);
      for (const m of norm.matchAll(MONTH_DAY)) add(iso(Number(m[3]), monthNumber(m[1]), Number(m[2])), unsure);
    };
    // Printed as is first; then with digit slips fixed; then glued to other digits (both less sure).
    scan(r.text, false);
    const fixed = fixDigitSlips(r.text);
    if (!inRow && fixed !== r.text) scan(fixed, true);
    if (!inRow) for (const m of fixed.matchAll(DMY_GLUED)) add(iso(year(m[4]), Number(m[3]), Number(m[1])), true);
  });

  if (!found.length) {
    warnings.push(
      future
        ? 'The date on the receipt is in the future, so it was not used. Today is filled in instead.'
        : old
          ? 'The date on the receipt looks wrong (more than two years ago), so it was not used. Today is filled in instead.'
          : 'No date was found on the receipt. Today is filled in instead.',
    );
    return { value: today, confidence: 'low', source: null };
  }
  const distinct = [...new Set(found.map((f) => f.date))];
  const pick = distinct.length === 1 ? found[0] : (found.find((f) => f.labelled) ?? found[0]);
  let confidence: Confidence = pick.date >= addDays(today, -RECENT_DAYS) ? 'high' : 'low';
  if (distinct.length > 1) {
    confidence = 'low';
    warnings.push('The receipt shows more than one date. Check the date.');
  }
  if (pick.confidence !== null && pick.confidence < WEAK_OCR) confidence = LOWER[confidence];
  if (pick.unsure) confidence = LOWER[confidence];
  return { value: pick.date, confidence, source: pick.source };
}

// ---------------------------------------------------------------------------
// Merchant

/** Chains seen on Moroccan receipts, used when the merchant is not in the app yet. */
const KNOWN_BRANDS = [
  'Marjane',
  'Carrefour',
  'Carrefour Market',
  'BIM',
  'Acima',
  "Label'Vie",
  'Aswak Assalam',
  'Atacadao',
  'Metro',
  'Afriquia',
  'Shell',
  'TotalEnergies',
  'Petrom',
  'Winxo',
  'Ziz',
  'Inwi',
  'Maroc Telecom',
  'Orange',
  'McDonald’s',
  'KFC',
  'Burger King',
  'Starbucks',
  'Paul',
  'Decathlon',
  'Ikea',
  'Electroplanet',
  'Virgin Megastore',
  'Kitea',
  'LC Waikiki',
  'Zara',
];

/** Rows at the top of a receipt that are not the store's name. */
const NOT_A_NAME =
  /\b(BIENVENUE|WELCOME|MERCI|TICKET|FACTURE|RECU|CAISSE|CAISSIER|VENDEUR|SERVEUR|TABLE|CLIENT|COPIE|DUPLICATA|TEL|FAX|GSM|ICE|I\.?F|R\.?C|PATENTE|CNSS|RUE|AV|AVENUE|BD|BOULEVARD|ROUTE|LOT|LOTISSEMENT|IMM|IMMEUBLE|ANGLE|QUARTIER|HAY|RES|RESIDENCE|ZONE|N°|NO|CASABLANCA|RABAT|MARRAKECH|TANGER|FES|AGADIR|MEKNES|OUJDA|KENITRA|TETOUAN|SALE|MOHAMMEDIA|TEMARA|EL JADIDA|MAROC|MOROCCO|DATE|HEURE|WWW|HTTP)\b|@|\.COM\b/;
const LEGAL_SUFFIX = /\b(S\.?A\.?R\.?L\.?(\s*A\.?U\.?)?|S\.?A\.?|HOLDING|STE|SOCIETE)\b\.?/gi;

/** Compact key with common OCR digit/letter confusions folded, for fuzzy matching only. */
const looseKey = (s: string) => merchantKey(s).replace(/ /g, '').replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's');

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

type NameMatch = { name: string; id: string | null; confidence: Confidence; row: number; length: number };

function matchNames(rows: Row[], names: { id: string | null; name: string }[], exact: Confidence, partial: Confidence): NameMatch | null {
  let best: NameMatch | null = null;
  const consider = (m: NameMatch) => {
    const order = { high: 3, medium: 2, low: 1 };
    if (
      !best ||
      order[m.confidence] > order[best.confidence] ||
      (order[m.confidence] === order[best.confidence] && (m.length > best.length || (m.length === best.length && m.row < best.row)))
    ) {
      best = m;
    }
  };
  rows.forEach((r, i) => {
    const rowKey = ` ${merchantKey(r.text)} `;
    const words = rowKey.trim().split(' ');
    for (const n of names) {
      const key = merchantKey(n.name);
      if (key.length < 2) continue;
      if (rowKey.includes(` ${key} `)) {
        consider({ name: n.name, id: n.id, confidence: exact, row: i, length: key.length });
        continue;
      }
      // Fuzzy: any run of as many words as the name, one OCR slip apart ("CARREF0UR MARKET").
      const loose = looseKey(n.name);
      const k = key.split(' ').length;
      let fuzzy = false;
      for (let w = 0; loose.length >= 5 && w + k <= words.length && !fuzzy; w++) {
        const part = looseKey(words.slice(w, w + k).join(' '));
        fuzzy = part === loose || editDistance(part, loose) <= 1;
      }
      if (fuzzy) {
        consider({ name: n.name, id: n.id, confidence: partial, row: i, length: key.length });
      } else if (rowKey.trim().length >= 4 && ` ${key} `.includes(rowKey)) {
        // The receipt prints a shorter form of a known name ("MARJANE" for "Marjane Market").
        consider({ name: n.name, id: n.id, confidence: partial, row: i, length: rowKey.trim().length });
      }
    }
  });
  return best;
}

/** "PAIN COMPLET 400G" → "Pain Complet 400G": only all-caps words of letters change. */
function titleCase(s: string): string {
  if (/[a-z]/.test(s)) return s;
  return s
    .split(' ')
    .map((w) => (/^\p{Lu}[\p{Lu}']+$/u.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function findMerchant(rows: Row[], ctx: ParseContext, currency: string): ReceiptParse['merchantName'] {
  // Item and total rows carry amounts; the store's name does not ("JUS ORANGE 18,00" is not Orange).
  const top = rows.slice(0, 8).filter((r) => !findAmounts(r.text, currency).length);
  const existing = matchNames(top, (ctx.merchants ?? []).map((m) => ({ id: m.id, name: m.name })), 'high', 'medium');
  if (existing) return { value: existing.name, merchantId: existing.id, confidence: existing.confidence, source: top[existing.row].text };

  const brand = matchNames(top, KNOWN_BRANDS.map((name) => ({ id: null, name })), 'medium', 'low');
  if (brand) return { value: brand.name, merchantId: null, confidence: brand.confidence, source: top[brand.row].text };

  // Otherwise the store name printed at the top, if a row looks like one.
  const candidates = rows.slice(0, 5).filter((r) => {
    if (NOT_A_NAME.test(r.norm) || findAmounts(r.text, currency).length || /\d{2}[/.-]\d{2}/.test(r.text)) return false;
    // Unreadable characters mean a misread name: better none than a wrong one.
    if (/[?$%{}<>\\|]/.test(r.text)) return false;
    const letters = lettersIn(r.norm);
    const stripped = r.norm.replace(/[^A-Z0-9]/g, '');
    return letters >= 3 && letters / Math.max(1, stripped.length) >= 0.7 && r.text.length <= 40;
  });
  if (!candidates.length) return undefined;
  const pick = candidates.reduce((a, b) => ((b.height ?? 0) > (a.height ?? 0) ? b : a), candidates[0]);
  const name = titleCase(pick.text.replace(LEGAL_SUFFIX, '').replace(/[*#=_~|]+/g, ' ').replace(/\s+/g, ' ').trim());
  if (name.length < 3) return undefined;
  return { value: name, merchantId: null, confidence: 'low', source: pick.text };
}

// ---------------------------------------------------------------------------
// Items

const DISCOUNT = /REMISE|REDUCTION|PROMO|RABAIS|BON\s*D?\s*ACHAT/;
const NOT_ITEM =
  /\bTOTAL|\bNET\b|A\s*PAYER|\bH\.?T\b|\bT\.?V\.?A\b|\bT\.?T\.?C\b|\bTAXE|RENDU|MONNAIE|ESPECE|\bESP\b|\bCB\b|CARTE|VISA|MASTERCARD|\bCASH\b|CHEQUE|FIDELIT|POINTS|ECONOMI|SOLDE|MONTANT|TIMBRE|ARRONDI|\bPRIX\b|VOLUME|\bP\.?U\b|DESIGNATION|LIBELLE|\bQTE\b|\bQTY\b|QUANTITE|LITRES?\b|POMPE|NOMBRE|NBRE/;
// "2 x 12,50", "1,250 kg x 30,00", "45,23 L x 12,850", "2 @ 6,00"
const QTY_PRICE = /(\d+(?:[.,]\d{1,3})?)\s*(KG|G|L|PCS?|U)?\s*[X×*@]\s*(\d+[.,]\d{2,3})/i;
// A quantity alone between a name and its prices ("LAIT 2 7,50 15,00", "LAIT 7,50 2 15,00").
const QTY_ONLY = /(?:^|\s)(\d{1,3}(?:[.,]\d{1,3})?)(?:\s+(KG|G|L|PCS?|U))?\s*$/i;
const UNITS: Record<string, string> = { KG: 'kg', G: 'g', L: 'L', PC: 'piece', PCS: 'piece', U: 'piece' };
const DATE_LIKE = /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/;

/** Supermarket departments (rayons): printed with the subtotal of the lines above, never an item. */
const DEPARTMENTS = new Set([
  'BISCUITERIE',
  'MENAGE',
  'EPICERIE',
  'EPICERIE SALEE',
  'EPICERIE SUCREE',
  'BOUCHERIE',
  'BOULANGERIE',
  'VIENNOISERIE',
  'PATISSERIE',
  'CREMERIE',
  'FROMAGERIE',
  'CHARCUTERIE',
  'TRAITEUR',
  'POISSONNERIE',
  'FRUITS ET LEGUMES',
  'FRUITS LEGUMES',
  'PRIMEUR',
  'LIQUIDES',
  'BOISSONS',
  'DROGUERIE',
  'PARFUMERIE',
  'HYGIENE',
  'HYGIENE BEAUTE',
  'CONFISERIE',
  'SURGELES',
  'PRODUITS FRAIS',
  'LAITERIE',
  'TEXTILE',
  'BAZAR',
  'ELECTROMENAGER',
  'PAPETERIE',
  'BEBE',
  'ANIMALERIE',
  'JARDIN',
  'BRICOLAGE',
  'MULTIMEDIA',
  'ENTRETIEN',
  'DPH',
  'PGC',
]);
const isDepartment = (name: string) =>
  DEPARTMENTS.has(
    normalizeText(name)
      .replace(/[^A-Z ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

function cleanItemName(s: string): string {
  return titleCase(
    s
      .replace(/\(\d\)\s*\d{6,14}/g, ' ') // "(5)6221134002638": EAN with its check prefix
      .replace(/(^|\s)#?\d{6,14}(?=\s|$)/g, ' ') // EAN / article code, before or after the name
      .replace(/^\s*\d{4,5}\s+(?=\D)/, '') // short article code before the name
      .replace(/\s\d{1,2}(?:[.,]\d{1,2})?\s?%/g, ' ') // VAT rate column
      .replace(/\s[xX×]\s?1\s*$/, '') // "x1"
      .replace(/(\s[A-D*])+\s*$/i, '') // tax code letters after the name
      .replace(/[*#=_~|•:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

type Qty = { qty: number; unit: string | null; price: number | null };

/** A line as it is read, with what its confidence is worked out from. */
type Line = ReceiptItem & {
  ocr: number | null;
  /** Quantity × unit price equals the printed line total. */
  qtyAgrees: boolean;
  /** A department subtotal equals this line (and the others since the previous department). */
  subtotalAgrees: boolean;
  /** A quantity × price was printed but disagreed with the line total, so it was dropped. */
  qtyDropped: boolean;
  /** The line total was not printed: it is quantity × unit price. */
  computed: boolean;
  weakName: boolean;
};

type RowRead = {
  /** Text before the quantity, prices and line total. */
  name: string;
  hasName: boolean;
  /** The line total (last amount after any quantity). */
  line: AmountToken | null;
  q: Qty | null;
  /** Two price columns that do not agree with each other. */
  columnsDisagree: boolean;
};

function readRow(text: string, currency: string): RowRead {
  const amounts = findAmounts(text, currency);
  const read = (name: string, line: AmountToken | null, q: Qty | null, columnsDisagree = false): RowRead => ({
    name,
    hasName: lettersIn(normalizeText(name)) >= 2,
    line,
    q,
    columnsDisagree,
  });
  const qp = QTY_PRICE.exec(text);
  if (qp) {
    const qn = parseQuantity(qp[1].replace(',', '.'));
    const qtyEnd = qp.index + qp[0].length;
    const after = amounts.filter((a) => a.index >= qtyEnd);
    const q = qn === null ? null : { qty: qn, unit: qp[2] ? UNITS[qp[2].toUpperCase()] : null, price: findAmounts(qp[3], currency)[0]?.minor ?? null };
    return read(text.slice(0, qp.index), after.length ? after[after.length - 1] : null, q);
  }
  if (amounts.length >= 2) {
    // Columns: unit price then line total, with the quantity before or between them.
    const line = amounts[amounts.length - 1];
    const pu = amounts[amounts.length - 2];
    const between = QTY_ONLY.exec(text.slice(pu.end, line.index));
    const before = QTY_ONLY.exec(text.slice(0, pu.index));
    for (const m of [between, before]) {
      const qn = m ? parseQuantity(m[1].replace(',', '.')) : null;
      if (m && qn !== null && Math.abs(lineTotal(pu.minor, qn) - line.minor) <= 1) {
        const nameEnd = m === before ? before.index : pu.index;
        return read(text.slice(0, nameEnd), line, { qty: qn, unit: m[2] ? UNITS[m[2].toUpperCase()] : null, price: pu.minor });
      }
    }
    if (pu.minor === line.minor) return read(text.slice(0, pu.index), line, { qty: 0, unit: null, price: pu.minor });
    return read(text.slice(0, pu.index), line, null, true);
  }
  const line = amounts.length ? amounts[0] : null;
  return read(text.slice(0, line?.index ?? text.length), line, null);
}

/**
 * The item lines printed above the total (rows [0, end)). Each line keeps what its confidence is
 * worked out from. Layouts: name and amount on one row; the name on one row then "qty x price"
 * and/or the amount on the next rows; the quantity row after the line; columns (qty, unit price,
 * total); names wrapped on two rows; per-item discounts; department subtotals (skipped).
 */
function findItems(rows: Row[], end: number, startAfter: number, currency: string): Line[] {
  const items: Line[] = [];
  let pending: { name: string; index: number; rows: Row[] } | null = null;
  let pendingQty: Qty | null = null;
  let pendingDept = false;
  let sinceSubtotal: Line[] = [];

  const reset = () => {
    pending = null;
    pendingQty = null;
    pendingDept = false;
  };

  const subtotal = (minor: number) => {
    if (sinceSubtotal.length && signedSum(sinceSubtotal) === minor) for (const l of sinceSubtotal) l.subtotalAgrees = true;
    sinceSubtotal = [];
  };

  const add = (o: { name: string; total: number; discount: boolean; q: Qty | null; used: Row[]; computed?: boolean; columnsDisagree?: boolean }) => {
    let name = o.name;
    let q = o.q;
    let qtyDropped = !!o.columnsDisagree;
    const prev = items[items.length - 1];
    if (o.discount) {
      // A bare "REMISE -3,00" right after an item is that item's discount.
      const bare = lettersIn(normalizeText(name).replace(DISCOUNT, '').replace(/\d+([.,]\d+)?\s?%/g, '')) < 3;
      const own = cleanItemName(name);
      name = bare && prev?.lineKind === 'product' && o.total <= prev.totalMinor ? `Remise ${prev.name}` : own || 'Remise';
      q = null;
    } else {
      if (!q) {
        // "2 CAFE NOIR 24,00": a leading count; "LAIT x2 15,00": a trailing one.
        const lead = /^\s*(\d{1,2})\s+(?=[A-Za-z])/.exec(name);
        const trail = /\s[xX×]\s?(\d{1,2})\s*$/.exec(name);
        const m = lead ?? trail;
        const n = m ? parseQuantity(m[1]) : null;
        if (m && n !== null) {
          q = { qty: n, unit: null, price: null };
          name = lead ? name.slice(m[0].length) : name.slice(0, m.index);
        }
      }
      // Quantity × price must agree with the printed line total, or neither is kept.
      if (q?.price != null && q.qty > 0 && Math.abs(lineTotal(q.price, q.qty) - o.total) > 1) {
        q = null;
        qtyDropped = true;
      }
    }
    const cleaned = cleanItemName(name);
    if (!cleaned || o.total <= 0) return;
    const ocrs = o.used.map((r) => r.confidence).filter((c): c is number => c !== null);
    const letters = lettersIn(normalizeText(cleaned));
    const line: Line = {
      lineKind: o.discount ? 'discount' : 'product',
      name: cleaned,
      quantityMilli: q && q.qty > 0 ? q.qty : null,
      unit: q && q.qty > 0 ? q.unit : null,
      unitPriceMinor: q?.price ?? null,
      totalMinor: o.total,
      confidence: 'medium',
      source: o.used.map((r) => r.text).join(' / '),
      productId: null,
      categoryId: null,
      ocr: ocrs.length ? Math.min(...ocrs) : null,
      qtyAgrees: q?.price != null && q.qty > 0,
      subtotalAgrees: false,
      qtyDropped,
      computed: !!o.computed,
      weakName: letters < 3 || /[?$@{}<>\\]/.test(cleaned) || letters / cleaned.replace(/\s/g, '').length < 0.5,
    };
    items.push(line);
    sinceSubtotal.push(line);
  };

  let seenItem = false;
  const headerLike = (r: Row) => r.text.includes(':') || PHONE.test(r.norm) || DATE_LIKE.test(r.text) || (!seenItem && NOT_A_NAME.test(r.norm));

  for (let i = startAfter + 1; i < end; i++) {
    const r = rows[i];
    if (NOT_ITEM.test(r.norm) && !DISCOUNT.test(r.norm)) {
      reset();
      continue;
    }
    const rd = readRow(r.text, currency);
    const lead = /^\s*\d{1,2}\s+[A-Za-z]/.test(rd.name);
    const count = items.length;

    if (rd.line && (rd.line.negative || DISCOUNT.test(r.norm))) {
      add({ name: rd.name, total: rd.line.minor, discount: true, q: null, used: [r] });
      reset();
    } else if (DISCOUNT.test(r.norm)) {
      reset();
    } else if (rd.hasName && isDepartment(rd.name)) {
      if (rd.line) subtotal(rd.line.minor);
      reset();
      pendingDept = !rd.line;
    } else if (rd.hasName && rd.line) {
      // A name wrapped on two rows: the row above has no amount and this one does not start a new line.
      const joined = pending && pending.index === i - 1 && !lead ? pending : null;
      const name = joined ? `${joined.name} ${rd.name}` : rd.name;
      const used = joined ? [...joined.rows, r] : [r];
      add({ name, total: rd.line.minor, discount: false, q: rd.q ?? pendingQty, used, columnsDisagree: rd.columnsDisagree });
      reset();
    } else if (rd.hasName && rd.q?.price != null) {
      // "POULET 1,250 KG X 62,00" with no line total printed.
      add({ name: rd.name, total: lineTotal(rd.q.price, rd.q.qty), discount: false, q: rd.q, used: [r], computed: true });
      reset();
    } else if (rd.hasName) {
      // A name on its own row: its quantity and amount follow (or it wraps onto the next row).
      if (headerLike(r)) reset();
      else if (pending && pending.index === i - 1 && pending.rows.length < 2 && !lead) {
        pending = { name: `${pending.name} ${rd.name}`, index: i, rows: [...pending.rows, r] };
      } else {
        reset();
        pending = { name: rd.name, index: i, rows: [r] };
      }
    } else if (rd.line && pendingDept) {
      subtotal(rd.line.minor);
      reset();
    } else if (rd.line && pending) {
      const p: { name: string; rows: Row[] } = pending;
      add({ name: p.name, total: rd.line.minor, discount: false, q: rd.q ?? pendingQty, used: [...p.rows, r] });
      reset();
    } else if (rd.q) {
      // "2 x 4,95" on its own row: for the name above (amount still to come), or for the line just read.
      const prev = items[items.length - 1];
      const fits =
        prev?.lineKind === 'product' &&
        prev.quantityMilli === null &&
        rd.q.price !== null &&
        Math.abs(lineTotal(rd.q.price, rd.q.qty) - prev.totalMinor) <= 1 &&
        (!rd.line || rd.line.minor === prev.totalMinor);
      if (pending) pendingQty = rd.q;
      else if (fits) {
        prev.quantityMilli = rd.q.qty;
        prev.unit = rd.q.unit;
        prev.unitPriceMinor = rd.q.price;
        prev.qtyAgrees = true;
        prev.source = `${prev.source} / ${r.text}`;
      } else pendingQty = rd.q;
    }
    if (items.length > count) seenItem = true;
  }
  return items;
}

/** Stamp duty printed as "dont droits de timbre": inside the total, but not on any item line. */
function findStamp(rows: Row[], from: number, currency: string): Adjustment | null {
  for (let i = from; i < rows.length; i++) {
    const r = rows[i];
    if (!STAMP.test(r.norm) || !DONT_SLIP.test(r.norm)) continue;
    const at = r.text.search(/timbre/i);
    const a = findAmounts(r.text, currency).find((x) => x.index > at && !x.negative && x.minor > 0);
    if (a) return { kind: 'charge', name: 'Droits de timbre', minor: a.minor, source: r.text, confidence: r.confidence };
  }
  return null;
}

const FUEL = /\b(GASOIL|GAZOIL|DIESEL|SANS\s*PLOMB|SSP|SP\s?9[58]|SUPER|ESSENCE|GPL)\b/;
const FUEL_NAMES: Record<string, string> = { GAZOIL: 'Gasoil', 'SANS PLOMB': 'Sans plomb', SSP: 'Sans plomb', GPL: 'GPL' };
const LITRES = /(\d+(?:[.,]\d{1,3})?)\s*(?:L|LT|LTR|LITRES?)\b/i;
const PER_LITRE = /\bPRIX\b|\bP\.?U\b|\/\s*L\b|\/\s*LITRE/;

/**
 * Fuel receipts: the fuel is the one item; volume and price per litre are its quantity and unit
 * price (kept only when they agree with the amount), never items of their own.
 */
function findFuel(rows: Row[], end: number, amount: number, currency: string): Line | null {
  const fuelRow = rows.slice(0, end).find((r) => FUEL.test(r.norm));
  if (!fuelRow) return null;
  const volRow = rows.find((r) => /VOLUME|LITRE|\bQTE\b|QUANTITE/.test(r.norm) || (LITRES.test(r.text) && !PER_LITRE.test(r.norm)));
  const priceRow = rows.find((r) => r !== volRow && PER_LITRE.test(r.norm));
  if (!volRow && !priceRow) return null;
  const fuel = FUEL.exec(fuelRow.norm)![1].replace(/\s+/g, ' ');
  const vol = volRow ? (LITRES.exec(volRow.text) ?? /(\d+[.,]\d{1,3})/.exec(volRow.text)) : null;
  const qty = vol ? parseQuantity(vol[1].replace(',', '.')) : null;
  const price = priceRow ? (findAmounts(priceRow.text, currency)[0]?.minor ?? null) : null;
  const agrees = qty !== null && price !== null && Math.abs(lineTotal(price, qty) - amount) <= 1;
  const used = [fuelRow, ...(volRow ? [volRow] : []), ...(priceRow ? [priceRow] : [])];
  const ocrs = used.map((r) => r.confidence).filter((c): c is number => c !== null);
  return {
    lineKind: 'product',
    name: FUEL_NAMES[fuel] ?? titleCase(fuel),
    quantityMilli: agrees ? qty : null,
    unit: agrees ? 'L' : null,
    unitPriceMinor: agrees ? price : null,
    totalMinor: amount,
    confidence: 'medium',
    source: used.map((r) => r.text).join(' / '),
    productId: null,
    categoryId: null,
    ocr: ocrs.length ? Math.min(...ocrs) : null,
    qtyAgrees: agrees,
    subtotalAgrees: false,
    qtyDropped: qty !== null && price !== null && !agrees,
    computed: false,
    weakName: false,
  };
}

const adjustmentLine = (a: Adjustment): Line => ({
  lineKind: a.kind,
  name: a.name,
  quantityMilli: null,
  unit: null,
  unitPriceMinor: null,
  totalMinor: a.minor,
  confidence: 'medium',
  source: a.source,
  productId: null,
  categoryId: null,
  ocr: a.confidence,
  qtyAgrees: false,
  subtotalAgrees: false,
  qtyDropped: false,
  computed: false,
  weakName: false,
});

/** An existing product with this name: accent/case-insensitive, or one OCR slip apart when only one is that close. */
function matchProduct(name: string, products: NonNullable<ParseContext['products']>) {
  const key = merchantKey(name);
  if (!key) return null;
  const exact = products.find((p) => merchantKey(p.name) === key);
  if (exact) return exact;
  const loose = looseKey(name);
  if (loose.length < 5) return null;
  const close = products.filter((p) => {
    const k = looseKey(p.name);
    return k === loose || editDistance(k, loose) <= 1;
  });
  return close.length === 1 ? close[0] : null;
}

// ---------------------------------------------------------------------------

export function parseReceipt(lines: (OcrLine | string)[], ctx: ParseContext): ReceiptParse {
  const currency = ctx.currency ?? BASE_CURRENCY;
  const money = (minor: number) => formatMoney(minor, currency);
  const rows = toRows(lines);
  const warnings: string[] = [];
  const result: ReceiptParse = { date: { value: ctx.today, confidence: 'low', source: null }, warnings };

  if (!rows.length) {
    warnings.push('No text could be read on this photo. Fill in the expense by hand; the photo is still attached.');
    return result;
  }

  // Two amounts: the total of the lines, and what was paid (when printed apart, below the total).
  const candidates = findTotal(rows, currency);
  const finals = pickCandidate(candidates.filter((c) => c.kind === 'final'));
  const totals = pickCandidate(candidates.filter((c) => c.kind === 'total' && (!finals || c.row < finals.pick.row)));
  const end = candidates.length ? Math.min(...candidates.map((c) => c.row)) : rows.length;
  const toField = (p: NonNullable<typeof totals>, message: string): Field<number> => {
    if (p.conflict) warnings.push(message);
    return { value: p.pick.minor, confidence: p.conflict ? 'low' : p.pick.rank >= 4 ? 'high' : 'medium', source: p.pick.source };
  };
  let final = finals ? toField(finals, 'The receipt shows different amounts to pay. Check the amount.') : undefined;
  let total = totals ? toField(totals, 'The receipt shows different totals. Check the amount.') : undefined;
  if (!total && final) total = { ...final };
  // Agreement between two figures raises a field (unless the receipt itself disagrees); a mismatch lowers it.
  const raise = (f: Field<number> | undefined, conflict: boolean | undefined) => {
    if (f && !conflict) f.confidence = RAISE[f.confidence];
  };
  const lower = (f: Field<number> | undefined) => {
    if (f) f.confidence = LOWER[f.confidence];
  };

  // Total − global discounts + charges (rounding, stamp duty, service) = amount paid.
  let adjustments: Adjustment[] = [];
  const net = (from: number) => adjustments.reduce((s, a) => s + (a.kind === 'discount' ? -a.minor : a.minor), from);
  if (totals && finals && total && final) {
    if (total.value === final.value) {
      raise(total, totals.conflict);
      raise(final, finals.conflict);
    } else {
      adjustments = findAdjustments(rows, totals.pick.row + 1, finals.pick.row, currency);
      if (net(total.value) === final.value) {
        raise(total, totals.conflict);
        raise(final, finals.conflict);
      } else {
        warnings.push(
          adjustments.length
            ? `The total (${money(total.value)}) with the discounts and charges printed (${money(net(total.value))}) does not match the amount to pay (${money(final.value)}). Check the amount.`
            : `The total (${money(total.value)}) and the amount to pay (${money(final.value)}) differ, and no discount or charge explains it. Check the amount.`,
        );
        lower(final);
        adjustments = [];
      }
    }
  }

  // What the payment lines say was paid: cash given − change, or the card amount.
  const paid = paymentEvidence(rows, currency);
  let derived = false;
  if (total && !final && totals) {
    // "TOTAL 100 / REMISE -10 / CB 90": a printed payment confirms the discounted amount.
    const after = findAdjustments(rows, totals.pick.row + 1, rows.length, currency);
    const p = paid.card ?? paid.cash;
    if (after.length && p !== null && p !== total.value) {
      adjustments = after;
      if (net(total.value) === p) {
        final = { value: p, confidence: 'medium', source: paid.card !== null ? paid.cardSource : null };
        derived = true;
      } else adjustments = [];
    }
  }
  const amount = final ?? total;
  const amountConflict = final ? finals?.conflict : totals?.conflict;
  if (amount) {
    // A payment-derived amount is already checked against its payment line.
    const confirmed = paid.cash === amount.value || paid.card === amount.value;
    if (confirmed && !derived) raise(amount, amountConflict);
    else if (confirmed) {
      // Derived from that payment line: nothing more to check.
    } else if (paid.card !== null && paid.given === null) {
      lower(amount);
      warnings.push(`The card payment on the receipt (${money(paid.card)}) differs from the amount to pay (${money(amount.value)}). Check the amount.`);
    } else if (paid.cash !== null) {
      lower(amount);
      warnings.push(`The cash given minus the change (${money(paid.cash)}) differs from the amount to pay (${money(amount.value)}). Check the amount.`);
    }
    const weak = (f: Field<number> | undefined, c: TotalCandidate | undefined) => {
      if (f && c && c.confidence !== null && c.confidence < WEAK_OCR) lower(f);
    };
    weak(total, totals?.pick ?? finals?.pick);
    if (finals) weak(final, finals.pick);
    result.totalMinor = total;
    if (final) result.finalMinor = final;
  } else {
    warnings.push('No total was found. Enter the amount paid.');
  }

  result.date = findDate(rows, ctx.today, warnings);

  const merchant = findMerchant(rows, ctx, currency);
  if (merchant) result.merchantName = merchant;
  else warnings.push('The store name was not recognised.');

  // Items: every line read, with the part of the amount no line was read for on its own line.
  if (amount && total) {
    const firstAmountRow = rows.findIndex((r) => findAmounts(r.text, currency).length > 0);
    const merchantRow = merchant ? rows.findIndex((r) => r.text === merchant.source) : -1;
    const startAfter = merchantRow >= 0 && merchantRow < firstAmountRow ? merchantRow : -1;
    const read0 = findItems(rows, end, startAfter, currency);
    const fuel = read0.some((l) => l.lineKind === 'product') ? null : findFuel(rows, end, amount.value, currency);
    const lines = fuel ? [fuel] : read0;
    if (lines.some((l) => l.lineKind === 'product')) {
      let read = signedSum(lines);
      if (!fuel && read < total.value) {
        const stamp = findStamp(rows, end, currency);
        if (stamp && read + stamp.minor <= total.value) {
          lines.push(adjustmentLine(stamp));
          read += stamp.minor;
        }
      }
      if (!fuel) lines.push(...adjustments.map(adjustmentLine));
      const sum = signedSum(lines);
      const gap = amount.value - sum;
      if (gap < 0) {
        warnings.push(
          `The item lines add up to ${money(sum)}, more than the ${final ? 'amount to pay' : 'total'} (${money(amount.value)}), so a line was misread. No items were filled in; add them by hand if you want them.`,
        );
      } else {
        const exact = fuel !== null || read === total.value;
        if (exact && !fuel) raise(total, totals?.conflict);
        if (!exact) {
          warnings.push(
            `The item lines read add up to ${money(read)} and the total is ${money(total.value)}: the difference (${money(gap)}) is on a "${UNREAD_ITEM_NAME}" line.`,
          );
        }
        const products = ctx.products ?? [];
        const items: ReceiptItem[] = lines.map((l) => {
          let c: Confidence = l.qtyDropped ? 'low' : l.qtyAgrees || l.subtotalAgrees || exact ? 'high' : 'medium';
          if (l.computed && c === 'high') c = 'medium';
          if (l.weakName) c = LOWER[c];
          if (l.ocr !== null && l.ocr < WEAK_OCR) c = LOWER[c];
          const product = l.lineKind === 'product' ? matchProduct(l.name, products) : null;
          return {
            lineKind: l.lineKind,
            name: product?.name ?? l.name,
            quantityMilli: l.quantityMilli,
            unit: l.unit,
            unitPriceMinor: l.unitPriceMinor,
            totalMinor: l.totalMinor,
            confidence: c,
            source: l.source,
            productId: product?.id ?? null,
            categoryId: product?.categoryId ?? null,
          };
        });
        const confidence = weakest([...items.map((i) => i.confidence), exact ? 'high' : 'medium']);
        if (gap > 0) {
          items.push({
            lineKind: 'unallocated',
            name: UNREAD_ITEM_NAME,
            quantityMilli: null,
            unit: null,
            unitPriceMinor: null,
            totalMinor: gap,
            confidence: 'low',
            source: null,
            productId: null,
            categoryId: null,
          });
        }
        result.items = { value: items, confidence, source: null };
        result.unreadMinor = gap;
        result.productCategoryId = usualCategory(items);
      }
    }
  }

  return result;
}

/** The category most of the matched products are usually bought under (the first one on a tie). */
function usualCategory(items: ReceiptItem[]): string | null {
  const counts = new Map<string, number>();
  for (const it of items) if (it.categoryId) counts.set(it.categoryId, (counts.get(it.categoryId) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of counts) if (best === null || n > counts.get(best)!) best = id;
  return best;
}
