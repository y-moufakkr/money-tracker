import { requireOptionalNativeModule } from 'expo';

import type { OcrLine } from '@/domain/receipt-parse';

type Recognized = { width: number; height: number; lines: OcrLine[] };

type ReceiptOcrNative = { recognizeAsync(uri: string): Promise<Recognized> };

// The local module in modules/receipt-ocr. Null in a build made before it was added.
const native = requireOptionalNativeModule<ReceiptOcrNative>('ReceiptOcr');

/** Whether this build can read receipts (on the device; nothing is sent anywhere). */
export const ocrAvailable = native !== null;

/** The text lines of a photo, or null when this build has no text recognition. */
export async function recognizeReceipt(uri: string): Promise<OcrLine[] | null> {
  if (!native) return null;
  const r = await native.recognizeAsync(uri);
  return r.lines;
}
