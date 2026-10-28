import { requireOptionalNativeModule } from 'expo';

import type { OcrResult } from '@/domain/receipt-parse';

type ReceiptOcrNative = { recognizeAsync(uri: string): Promise<OcrResult> };

// The local module in modules/receipt-ocr. Null in a build made before it was added.
const native = requireOptionalNativeModule<ReceiptOcrNative>('ReceiptOcr');

/** Whether this build can read receipts (on the device; nothing is sent anywhere). */
export const ocrAvailable = native !== null;

/** The text lines of a photo with the image size, or null when this build has no text recognition. */
export async function recognizeReceipt(uri: string): Promise<OcrResult | null> {
  if (!native) return null;
  return native.recognizeAsync(uri);
}
