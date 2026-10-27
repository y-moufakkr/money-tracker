import type { ReceiptParse } from '@/domain/receipt-parse';
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
