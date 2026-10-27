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
import { BASE_CURRENCY, lineTotal, parseAmount, parseQuantity } from './money';

export type OcrBox = { x: number; y: number; width: number; height: number };

/** One recognised line. Boxes (image pixels, top-left origin) let lines on the same row be joined. */
export type OcrLine = { text: string; confidence?: number | null; box?: OcrBox | null };

export type Confidence = 'high' | 'medium' | 'low';

export type Field<T> = {
  value: T;
  confidence: Confidence;
  /** The printed text the value was read from (null when nothing was printed, e.g. today's date). */
  source: string | null;
};

export type ReceiptItem = {
  lineKind: 'product' | 'discount';
  name: string;
  quantityMilli: number | null;
  unit: string | null;
  unitPriceMinor: number | null;
  /** Always positive; a discount reduces the receipt. */
  totalMinor: number;
};

export type ReceiptParse = {
  totalMinor?: Field<number>;
  /** Always set: the printed date, or today (low confidence) when none was found. */
  date: Field<string>;
  merchantName?: Field<string> & { merchantId: string | null };
  /** Only when the lines add up to the total within a small tolerance. */
  items?: Field<ReceiptItem[]>;
  warnings: string[];
};

export type ParseContext = {
  /** YYYY-MM-DD in the app's calendar. */
  today: string;
  /** Existing merchants, matched accent- and case-insensitively so they are reused. */
  merchants?: { id: string; name: string }[];
  currency?: string;
};

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

const TOTAL_LABELS: { re: RegExp; rank: number }[] = [
  { re: /\bNET\s*A\s*PAYER\b/, rank: 5 },
  { re: /\b(TOTAL|MONTANT|SOMME)?\s*A\s*PAYER\b/, rank: 5 },
  { re: /\b(TOTAL|MONTANT)\s*T\.?T\.?C\b/, rank: 4 },
  { re: /\bTOTAL\s*(GENERAL|NET)\b/, rank: 4 },
  { re: /\bT\.?T\.?C\b/, rank: 3 },
  { re: /\bTOTAL\b/, rank: 3 },
  { re: /\bMONTANT\b/, rank: 3 },
];

/** Rows that carry an amount but are never the total paid. */
const NOT_TOTAL =
  /\bH\.?T\b|HORS\s*TAXE|\bT\.?V\.?A\b|\bTAXE|REMISE|REDUCTION|PROMO|\bRENDU|MONNAIE|ESPECE|\bESP\b|\bCB\b|CARTE|VISA|MASTERCARD|\bCASH\b|CHEQUE|ECONOMI|FIDELIT|POINTS|SOUS[\s-]*TOTAL|S\/\s*TOTAL|\bNB\.?\s*ART|NOMBRE|NBRE|\bQTE\b|QUANTITE|TIMBRE|AVOIR/;

const CASH_GIVEN = /ESPECE|\bESP\b|\bCASH\b|\bRECU\b/;
const CHANGE = /\bRENDU|MONNAIE/;
const CARD = /\bCB\b|CARTE|VISA|MASTERCARD|\bTPE\b/;

type TotalCandidate = { minor: number; rank: number; row: number; source: string; confidence: number | null };

/** "TOTAL TTC DONT TVA": what follows "dont" (of which) is a part of the total, not another line. */
const DONT = /\bDONT\b.*$/;

/** "T O T A L" read as "TOTA L": joins runs of short words when one of them is a single letter. */
function joinSpacedLetters(norm: string): string {
  return norm.replace(/\b[A-Z]{1,4}(?: [A-Z]{1,4})+\b/g, (m) => (/\b[A-Z]\b/.test(m) ? m.replace(/ /g, '') : m));
}

function totalRank(norm: string): number {
  const label = norm.replace(DONT, '');
  const joined = joinSpacedLetters(label);
  if (NOT_TOTAL.test(label) || NOT_TOTAL.test(joined)) return 0;
  for (const text of [label, joined]) for (const l of TOTAL_LABELS) if (l.re.test(text)) return l.rank;
  return 0;
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
    const rank = totalRank(r.norm);
    if (!rank) return;
    const amounts = findAmounts(r.text, currency).filter((a) => !a.negative && a.minor > 0);
    if (amounts.length >= TABLE_AMOUNTS) return;
    if (amounts.length) {
      // With "dont TVA …" on the row, the total is the larger amount; otherwise the last one.
      const a = DONT.test(r.norm) ? amounts.reduce((m, x) => (x.minor > m.minor ? x : m)) : amounts[amounts.length - 1];
      candidates.push({ minor: a.minor, rank, row: i, source: r.text, confidence: r.confidence });
    } else if (rows[i + 1]) {
      const next = rows[i + 1];
      const a = loneAmount(next.text, currency) ?? besideAmount(r, next, currency);
      if (a && a.minor > 0) {
        candidates.push({ minor: a.minor, rank, row: i, source: `${r.text} ${next.text}`, confidence: next.confidence });
      }
    }
  });
  return candidates;
}

/** What the payment lines say was paid: cash given − change, or the card amount. */
function paymentEvidence(rows: Row[], currency: string) {
  const firstAmount = (re: RegExp, exclude?: RegExp) => {
    for (const r of rows) {
      if (!re.test(r.norm) || (exclude && exclude.test(r.norm))) continue;
      const a = findAmounts(r.text, currency).filter((x) => !x.negative);
      if (a.length) return a[a.length - 1].minor;
    }
    return null;
  };
  const given = firstAmount(CASH_GIVEN, CHANGE);
  const change = firstAmount(CHANGE);
  const card = firstAmount(CARD, /\bTOTAL\b/);
  return { cash: given !== null && change !== null && given >= change ? given - change : null, card, given };
}

const LOWER: Record<Confidence, Confidence> = { high: 'medium', medium: 'low', low: 'low' };

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

function findDate(rows: Row[], today: string, warnings: string[]): Field<string> {
  const found: { date: string; row: number; labelled: boolean; source: string; confidence: number | null }[] = [];
  let future = false;
  let old = false;
  rows.forEach((r, i) => {
    if (PHONE.test(r.norm) && !/\bDATE\b/.test(r.norm)) return;
    const add = (date: string | null) => {
      if (!date) return;
      if (date > today) return void (future = true);
      if (date < addDays(today, -MAX_AGE_DAYS)) return void (old = true);
      found.push({ date, row: i, labelled: /\bDATE\b|\bLE\b/.test(r.norm), source: r.text, confidence: r.confidence });
    };
    for (const m of r.text.matchAll(DMY)) {
      const y = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
      add(iso(y, Number(m[3]), Number(m[2])));
    }
    for (const m of r.text.matchAll(YMD)) add(iso(Number(m[2]), Number(m[3]), Number(m[4])));
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
    .map((w) => (/^[A-Z][A-Z']+$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
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
  /\bTOTAL|\bNET\b|A\s*PAYER|\bH\.?T\b|\bT\.?V\.?A\b|\bT\.?T\.?C\b|\bTAXE|RENDU|MONNAIE|ESPECE|\bESP\b|\bCB\b|CARTE|VISA|MASTERCARD|\bCASH\b|CHEQUE|FIDELIT|POINTS|ECONOMI|SOLDE|MONTANT|TIMBRE|ARRONDI|\bPRIX\b|VOLUME|\bPU\b/;
// "2 x 12,50", "1,250 kg x 30,00", "45,23 L x 12,850", "2 @ 6,00"
const QTY_PRICE = /(\d+(?:[.,]\d{1,3})?)\s*(KG|G|L|PCS?|U)?\s*[X×*@]\s*(\d+[.,]\d{2,3})/i;
const UNITS: Record<string, string> = { KG: 'kg', G: 'g', L: 'L', PC: 'piece', PCS: 'piece', U: 'piece' };

function cleanItemName(s: string): string {
  return titleCase(
    s
      .replace(/^\s*\d{5,}\s*/, '') // article code / EAN
      .replace(/\s+\d{1,2}(?:[.,]\d{1,2})?\s?%\s*$/, '') // VAT rate column
      .replace(/\s+[A-D*]$/i, '') // tax code after the name
      .replace(/[*#=_~|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function findItems(rows: Row[], totalRow: number, currency: string): { items: ReceiptItem[]; lowOcr: boolean } {
  const items: ReceiptItem[] = [];
  type Qty = { qty: number; unit: string | null; price: number | null };
  let pendingName: string | null = null;
  let pendingQty: Qty | null = null;
  let lowOcr = false;

  const push = (rawName: string, total: number, negative: boolean, norm: string, q: Qty | null) => {
    const discount = DISCOUNT.test(norm) || negative;
    let name = rawName;
    let qty = q;
    if (!qty) {
      // "2 CAFE NOIR 24,00": a leading count.
      const lead = /^\s*(\d{1,2})\s+(?=[A-Za-z])/.exec(name);
      const n = lead ? parseQuantity(lead[1]) : null;
      if (lead && n !== null) {
        qty = { qty: n, unit: null, price: null };
        name = name.slice(lead[0].length);
      }
    }
    // Quantity × price must agree with the printed line total, or neither is kept.
    if (qty?.price != null && Math.abs(lineTotal(qty.price, qty.qty) - total) > 1) qty = null;
    const cleaned = cleanItemName(name);
    if (!cleaned || total <= 0) return;
    items.push({
      lineKind: discount ? 'discount' : 'product',
      name: cleaned,
      quantityMilli: discount ? null : (qty?.qty ?? null),
      unit: discount ? null : (qty?.unit ?? null),
      unitPriceMinor: discount ? null : (qty?.price ?? null),
      totalMinor: total,
    });
  };

  for (let i = 0; i < totalRow; i++) {
    const r = rows[i];
    if (NOT_ITEM.test(r.norm) && !DISCOUNT.test(r.norm)) {
      pendingName = null;
      pendingQty = null;
      continue;
    }
    const amounts = findAmounts(r.text, currency);
    const qp = QTY_PRICE.exec(r.text);
    const qtyEnd = qp ? qp.index + qp[0].length : 0;
    const qn = qp ? parseQuantity(qp[1].replace(',', '.')) : null;
    const q: Qty | null =
      qp && qn !== null ? { qty: qn, unit: qp[2] ? UNITS[qp[2].toUpperCase()] : null, price: findAmounts(qp[3], currency)[0]?.minor ?? null } : null;
    const after = amounts.filter((a) => a.index >= qtyEnd);
    const line = after.length ? after[after.length - 1] : null;
    const name = r.text.slice(0, qp ? qp.index : (line?.index ?? r.text.length));
    const hasName = lettersIn(normalizeText(name)) >= 2;
    if (r.confidence !== null && r.confidence < WEAK_OCR) lowOcr = true;

    if (hasName && line) {
      push(name, line.minor, line.negative, r.norm, q ?? pendingQty);
      pendingName = null;
      pendingQty = null;
    } else if (hasName && q?.price != null) {
      push(name, lineTotal(q.price, q.qty), false, r.norm, q);
      pendingName = null;
      pendingQty = null;
    } else if (hasName) {
      // Name on its own row; its quantity and amount follow.
      pendingName = name;
      pendingQty = null;
    } else if (q && pendingName && line) {
      push(pendingName, line.minor, line.negative, normalizeText(pendingName), q);
      pendingName = null;
    } else if (!q && pendingName && line) {
      push(pendingName, line.minor, line.negative, normalizeText(pendingName), null);
      pendingName = null;
    } else if (q && !line) {
      const prev = items[items.length - 1];
      if (prev && prev.lineKind === 'product' && prev.quantityMilli === null && q.price != null && Math.abs(lineTotal(q.price, q.qty) - prev.totalMinor) <= 1) {
        prev.quantityMilli = q.qty;
        prev.unit = q.unit;
        prev.unitPriceMinor = q.price;
      } else {
        pendingQty = q;
      }
    }
  }
  return { items, lowOcr };
}

/** Items are proposed only when they add up to the total within this many minor units. */
export function itemTolerance(totalMinor: number): number {
  return Math.min(100, Math.max(2, Math.round(totalMinor * 0.005)));
}

// ---------------------------------------------------------------------------

export function parseReceipt(lines: (OcrLine | string)[], ctx: ParseContext): ReceiptParse {
  const currency = ctx.currency ?? BASE_CURRENCY;
  const rows = toRows(lines);
  const warnings: string[] = [];
  const result: ReceiptParse = { date: { value: ctx.today, confidence: 'low', source: null }, warnings };

  if (!rows.length) {
    warnings.push('No text could be read on this photo. Fill in the expense by hand; the photo is still attached.');
    return result;
  }

  // Total
  const candidates = findTotal(rows, currency);
  let totalRow = rows.length;
  if (candidates.length) {
    const top = Math.max(...candidates.map((c) => c.rank));
    const best = candidates.filter((c) => c.rank === top);
    const pick = best[best.length - 1];
    totalRow = Math.min(...candidates.map((c) => c.row));
    let confidence: Confidence = top >= 4 ? 'high' : 'medium';
    if (new Set(best.map((c) => c.minor)).size > 1) {
      confidence = 'low';
      warnings.push('The receipt shows different totals. Check the amount.');
    }
    const paid = paymentEvidence(rows, currency);
    if (paid.cash === pick.minor || paid.card === pick.minor) {
      if (confidence !== 'low') confidence = 'high';
    } else if (paid.card !== null && paid.given === null) {
      confidence = LOWER[confidence];
      warnings.push('The card payment on the receipt differs from its total. Check the amount.');
    }
    if (pick.confidence !== null && pick.confidence < WEAK_OCR) confidence = LOWER[confidence];
    result.totalMinor = { value: pick.minor, confidence, source: pick.source };
  } else {
    warnings.push('No total was found. Enter the amount paid.');
  }

  result.date = findDate(rows, ctx.today, warnings);

  const merchant = findMerchant(rows, ctx, currency);
  if (merchant) result.merchantName = merchant;
  else warnings.push('The store name was not recognised.');

  // Items: only when they add up to the total.
  if (result.totalMinor) {
    const { items, lowOcr } = findItems(rows, totalRow, currency);
    const sum = items.reduce((s, it) => s + (it.lineKind === 'discount' ? -it.totalMinor : it.totalMinor), 0);
    const diff = Math.abs(sum - result.totalMinor.value);
    if (items.some((it) => it.lineKind === 'product') && diff <= itemTolerance(result.totalMinor.value)) {
      result.items = { value: items, confidence: diff === 0 && !lowOcr ? 'high' : 'medium', source: null };
    } else if (items.length >= 2) {
      warnings.push('The item lines did not add up to the total, so the expense is not itemised. Add items by hand if you want them.');
    }
  }

  return result;
}
