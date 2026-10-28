/**
 * Real receipts: every `__fixtures__/receipts/<name>.json` (the OCR result exported from the phone:
 * lines with boxes and confidence) is parsed and compared with `<name>.expected.json`, written by
 * hand from the paper receipt. Only the keys present in the expected file are checked; `null`
 * means "must not be proposed". Every parser change must keep all of them passing.
 *
 * A new export without an expected file fails with the parser's current reading in the expected
 * format: copy it to `<name>.expected.json` and correct it against the paper.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { ocrExportJson } from '@/lib/receipt-drafts';
import { formatQuantity, minorToInput, parseAmount } from './money';
import { parseReceipt, receiptAmount, type OcrResult, type ParseContext, type ReceiptParse } from './receipt-parse';

const DIR = join(__dirname, '__fixtures__', 'receipts');

type ExpectedItem = { kind: string; name: string; qty: string | null; unit: string | null; unitPrice: string | null; total: string };
type Expected = {
  notes?: string;
  context?: Partial<ParseContext>;
  total?: string | null;
  final?: string | null;
  amount?: string | null;
  date?: string;
  merchant?: string | null;
  merchantId?: string | null;
  unread?: string | null;
  items?: ExpectedItem[] | null;
};

const amount = (minor: number | undefined) => (minor === undefined ? null : minorToInput(minor, 'MAD'));

/** The parse in the expected-file format (amounts as "149.27", quantities as "1.25"). */
function reading(r: ReceiptParse): Omit<Expected, 'notes' | 'context'> {
  return {
    total: amount(r.totalMinor?.value),
    final: amount(r.finalMinor?.value),
    amount: amount(receiptAmount(r)?.value),
    date: r.date.source === null ? undefined : r.date.value,
    merchant: r.merchantName?.value ?? null,
    merchantId: r.merchantName?.merchantId ?? null,
    unread: amount(r.unreadMinor),
    items:
      r.items?.value.map((i) => ({
        kind: i.lineKind,
        name: i.name,
        qty: i.quantityMilli === null ? null : formatQuantity(i.quantityMilli),
        unit: i.unit,
        unitPrice: i.unitPriceMinor === null ? null : minorToInput(i.unitPriceMinor, 'MAD'),
        total: minorToInput(i.totalMinor, 'MAD'),
      })) ?? null,
  };
}

const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json'))
  .map((f) => f.replace(/\.json$/, ''));

describe('receipt corpus (OCR exports from real receipts)', () => {
  it('has fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('%s', (name) => {
    const ocr = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as OcrResult;
    const expectedPath = join(DIR, `${name}.expected.json`);
    const expected: Expected = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, 'utf8')) : {};
    const today = expected.context?.today ?? '2026-10-27';
    const r = parseReceipt(ocr.lines, { ...expected.context, today });
    const actual = reading(r);
    if (!existsSync(expectedPath)) {
      throw new Error(`No ${name}.expected.json. The parser reads (check against the paper):\n${JSON.stringify({ context: { today }, ...actual }, null, 2)}`);
    }
    const { notes: _notes, context: _context, ...checked } = expected;
    // Amounts in the expected file may be written "9,90" or "9.90".
    const norm = (v: string | null | undefined) => (typeof v === 'string' && /^\d/.test(v) ? amount(parseAmount(v) ?? undefined) : v);
    const want = Object.fromEntries(
      Object.entries(checked).map(([k, v]) => [
        k,
        k === 'items' && Array.isArray(v)
          ? v.map((i: ExpectedItem) => ({ ...i, total: norm(i.total), unitPrice: norm(i.unitPrice) }))
          : k === 'date' || k === 'merchant' || k === 'merchantId'
            ? v
            : norm(v as string | null),
      ]),
    );
    const got = Object.fromEntries(Object.keys(want).map((k) => [k, actual[k as keyof typeof actual] ?? null]));
    expect(got).toEqual(want);
  });
});

describe('OCR export from the phone', () => {
  it('is a fixture file as is: one line per OCR line, read back unchanged', () => {
    const ocr = JSON.parse(readFileSync(join(DIR, 'bim-vision.json'), 'utf8')) as OcrResult;
    const text = ocrExportJson({ width: 1200, height: 2600, lines: ocr.lines }, 'ML Kit on android, exported 2026-10-28');
    expect(JSON.parse(text)).toEqual({ source: 'ML Kit on android, exported 2026-10-28', width: 1200, height: 2600, lines: ocr.lines });
    expect(text.split('\n')).toHaveLength(ocr.lines.length + 6);
  });
});
