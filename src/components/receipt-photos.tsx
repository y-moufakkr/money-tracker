import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Confidence } from '@/domain/receipt-parse';
import { useAttachmentUri } from '@/hooks/attachments';
import type { Attachment } from '@/services/attachments';
import { Icon } from '@/ui/icon';
import { Button, Row, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const THUMB = 72;

/** One photo: a stored attachment (by path) or a photo not saved yet (by URI). */
export function PhotoThumb({
  path,
  uri,
  size = THUMB,
  onPress,
  onRemove,
}: {
  path?: string;
  uri?: string;
  size?: number;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const c = useColors();
  const stored = useAttachmentUri(path).data;
  const source = uri ?? stored ?? null;
  return (
    <View style={{ width: size, height: size }}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'imagebutton' : 'image'}
        accessibilityLabel="Receipt photo"
        style={[styles.thumb, { width: size, height: size, backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
        {source ? (
          <Image source={{ uri: source }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
        ) : (
          <Icon name={path && stored === null ? 'broken_image' : 'image'} size={24} color={c.textMuted} />
        )}
      </Pressable>
      {onRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Remove photo"
          style={[styles.remove, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Icon name="close" size={16} color={c.text} />
        </Pressable>
      )}
    </View>
  );
}

export type PendingPhoto = { key: string; uri: string };

/** Photos of an expense on the form: stored ones, new ones, and buttons to add more. */
export function PhotoStrip({
  stored,
  pending,
  onRemoveStored,
  onRemovePending,
  onAdd,
  busy,
}: {
  stored: Attachment[];
  pending: PendingPhoto[];
  onRemoveStored: (id: string) => void;
  onRemovePending: (key: string) => void;
  onAdd: (from: 'camera' | 'library') => void;
  busy?: boolean;
}) {
  return (
    <View style={{ gap: space.sm, marginBottom: space.md }}>
      {(stored.length > 0 || pending.length > 0) && (
        <Row style={{ flexWrap: 'wrap' }} gap={space.md}>
          {stored.map((a) => (
            <PhotoThumb key={a.id} path={a.path} onPress={() => router.push(`/attachments/${a.id}`)} onRemove={() => onRemoveStored(a.id)} />
          ))}
          {pending.map((p) => (
            <PhotoThumb key={p.key} uri={p.uri} onRemove={() => onRemovePending(p.key)} />
          ))}
        </Row>
      )}
      <Row>
        <Button compact kind="secondary" icon="photo_camera" label="Take photo" onPress={() => onAdd('camera')} disabled={busy} />
        <Button compact kind="ghost" icon="image" label="Choose photo" onPress={() => onAdd('library')} disabled={busy} />
      </Row>
    </View>
  );
}

/** "Check this" under a field filled from a receipt; louder when the reading was uncertain. */
export function ReceiptHint({ confidence }: { confidence: Confidence }) {
  const c = useColors();
  const low = confidence === 'low';
  return (
    <Row gap={4} style={{ marginTop: -space.sm, marginBottom: space.md }}>
      <Icon name={low ? 'help' : 'document_scanner'} size={14} color={low ? c.warning : c.textMuted} />
      <Text variant="caption" color={low ? c.warning : c.textMuted}>
        {low ? 'Read from the receipt, not sure: check this' : 'Read from the receipt: check this'}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  thumb: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  remove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
