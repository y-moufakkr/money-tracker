import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { parseReceipt, type OcrResult, type ReceiptParse } from '@/domain/receipt-parse';
import { useDb } from '@/hooks/data';
import { notify } from '@/lib/confirm';
import { putDraft } from '@/lib/receipt-drafts';
import { ocrAvailable, recognizeReceipt } from '@/lib/receipt-ocr';
import { pickReceiptPhoto } from '@/lib/receipt-photo';
import { listMerchantNames, listProductNames } from '@/services/queries';
import { Banner, Button, IconBadge, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

/**
 * Scan a receipt: take or pick a photo, read it on the phone, then open the expense form with
 * the proposed fields. Nothing is saved here.
 */
export default function ScanScreen() {
  const c = useColors();
  const db = useDb();
  const params = useLocalSearchParams<{ from?: string }>();
  const [reading, setReading] = useState(false);
  const started = useRef(false);

  const scan = async (from: 'camera' | 'library') => {
    let photo: Awaited<ReturnType<typeof pickReceiptPhoto>>;
    try {
      photo = await pickReceiptPhoto(from);
    } catch (e) {
      notify('No photo', (e as Error).message);
      return;
    }
    if (!photo) return;
    setReading(true);
    let parse: ReceiptParse | null = null;
    let error: string | null = null;
    let ocr: OcrResult | null = null;
    try {
      ocr = await recognizeReceipt(photo.uri);
      if (ocr) {
        const [merchants, products] = await Promise.all([listMerchantNames(db), listProductNames(db)]);
        parse = parseReceipt(ocr.lines, { today: todayISO(), merchants, products });
      }
    } catch (e) {
      error = `The receipt could not be read (${(e as Error).message}). Fill in the expense by hand; the photo is attached.`;
    }
    const id = putDraft({ photo, parse, error, ocr });
    router.replace(`/entry/expense?draft=${encodeURIComponent(id)}`);
  };

  useEffect(() => {
    // Open the camera straight away on the phone (browsers only open a picker from a tap).
    if (started.current || Platform.OS === 'web' || params.from !== 'camera') return;
    started.current = true;
    void scan('camera');
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Scan receipt' }} />
      <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg, gap: space.lg, justifyContent: 'center' }}>
        {reading ? (
          <View style={{ alignItems: 'center', gap: space.md }}>
            <ActivityIndicator size="large" color={c.primary} />
            <Text variant="heading">Reading receipt…</Text>
            <Text tone="muted" style={{ textAlign: 'center' }}>
              On this phone only. Nothing is sent anywhere.
            </Text>
          </View>
        ) : (
          <>
            <View style={{ alignItems: 'center', gap: space.sm }}>
              <IconBadge icon="document_scanner" color={c.primary} size={64} />
              <Text variant="heading">Scan a receipt</Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                The amount, date, store and items are filled in for you to check. Nothing is saved until you tap Save, and the photo stays
                attached to the expense.
              </Text>
            </View>
            {!ocrAvailable && (
              <Banner tone="info">
                {Platform.OS === 'web'
                  ? 'Reading receipts works in the Android app. Here the photo is attached to an empty expense.'
                  : 'This version of the app cannot read receipts yet (install the new build). The photo is attached to an empty expense.'}
              </Banner>
            )}
            <Button icon="photo_camera" label="Take photo" onPress={() => void scan('camera')} />
            <Button kind="secondary" icon="image" label="Choose from gallery" onPress={() => void scan('library')} />
          </>
        )}
      </View>
    </>
  );
}
