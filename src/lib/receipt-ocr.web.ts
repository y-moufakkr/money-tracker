import type { OcrLine } from '@/domain/receipt-parse';

/** Web build (smoke tests only): no text recognition; a scan attaches the photo to an empty form. */
export const ocrAvailable = false;

export async function recognizeReceipt(_uri: string): Promise<OcrLine[] | null> {
  return null;
}
