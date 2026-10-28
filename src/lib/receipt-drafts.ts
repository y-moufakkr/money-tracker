import type { OcrResult, ReceiptParse } from '@/domain/receipt-parse';
import type { PickedPhoto } from './receipt-photo';

/**
 * Scanned receipts waiting for the expense form, kept in memory and keyed by id (route params
 * carry only the id, never the text). A draft is taken once by the form that opens it.
 */
export type ReceiptDraft = {
  photo: PickedPhoto;
  /** Null when this build cannot read text (web): the photo is attached to an empty form. */
  parse: ReceiptParse | null;
  /** Set when reading the text failed; the photo is still attached. */
  error: string | null;
  /**
   * What the OCR read (lines, boxes, confidence), kept only in memory so it can be shared from the
   * form to grow the parser's test corpus. Never stored in the database.
   */
  ocr: OcrResult | null;
};

const drafts = new Map<string, ReceiptDraft>();
let seq = 0;

export function putDraft(d: ReceiptDraft): string {
  const id = `receipt-${Date.now().toString(36)}-${++seq}`;
  drafts.set(id, d);
  return id;
}

export function getDraft(id: string | undefined): ReceiptDraft | null {
  return id ? (drafts.get(id) ?? null) : null;
}

export function dropDraft(id: string | undefined) {
  if (id) drafts.delete(id);
}

/**
 * The OCR result as a receipt fixture (`src/domain/__fixtures__/receipts/<name>.json`): one line
 * per recognised line so fixtures stay readable and diff well.
 */
export function ocrExportJson(ocr: OcrResult, source: string): string {
  const head = JSON.stringify({ source, width: ocr.width, height: ocr.height }).slice(1, -1);
  return `{\n ${head},\n "lines": [\n${ocr.lines.map((l) => `  ${JSON.stringify(l)}`).join(',\n')}\n ]\n}\n`;
}
