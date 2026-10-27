import { useState } from 'react';
import { Alert, View } from 'react-native';

import { ChipGroup, TextField } from '@/ui/fields';
import { Button, Card, Chip, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Rename + "merge into another" for catalog entries. Merging asks for
 * confirmation and explains that history moves to the target.
 */
export function RenameMerge({
  kind,
  name,
  candidates,
  onRename,
  onMerge,
  busy,
  mergeNote,
  mergeOnly,
}: {
  /** "merchant", "product", "tag", "category". */
  kind: string;
  name: string;
  candidates: { id: string; name: string }[];
  onRename: (name: string) => void;
  onMerge: (targetId: string, targetName: string) => void;
  busy?: boolean;
  mergeNote?: string;
  /** Hide the rename field (when the screen already edits the name). */
  mergeOnly?: boolean;
}) {
  const [draft, setDraft] = useState(name);
  const [merging, setMerging] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = candidates.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 20);

  const confirm = (target: { id: string; name: string }) =>
    Alert.alert(
      `Merge into “${target.name}”?`,
      `Everything recorded under “${name}” moves to “${target.name}”, and “${name}” is removed. ${mergeNote ?? 'Amounts and dates are unchanged.'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Merge', style: 'destructive', onPress: () => onMerge(target.id, target.name) },
      ],
    );

  return (
    <Card style={{ gap: space.sm }}>
      {!mergeOnly && <TextField label={`Rename ${kind}`} value={draft} onChangeText={setDraft} autoCapitalize="sentences" />}
      <Row style={{ flexWrap: 'wrap' }}>
        {!mergeOnly && (
          <Button compact label="Save name" disabled={!draft.trim() || draft.trim() === name} loading={busy} onPress={() => onRename(draft)} />
        )}
        <Button compact kind="ghost" icon="merge" label={merging ? 'Cancel merge' : 'Merge into…'} onPress={() => setMerging((v) => !v)} />
      </Row>
      {merging && (
        <View style={{ gap: space.sm }}>
          <Text variant="caption" tone="muted">
            Use this for duplicates (e.g. “Marjan” and “Marjane”). History is kept under the one you choose.
          </Text>
          <TextField placeholder={`Search ${kind}s`} value={query} onChangeText={setQuery} />
          {matches.length === 0 ? (
            <Text variant="caption" tone="muted">
              No other {kind} matches.
            </Text>
          ) : (
            <ChipGroup>
              {matches.map((m) => (
                <Chip key={m.id} label={m.name} onPress={() => confirm(m)} />
              ))}
            </ChipGroup>
          )}
        </View>
      )}
    </Card>
  );
}
