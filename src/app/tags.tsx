import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { RenameMerge } from '@/components/rename-merge';
import { useLedgerMutation, useTags } from '@/hooks/data';
import { openTransactions } from '@/lib/drill';
import { createTag, deleteTag, mergeTag, renameTag, setTagArchived, type TagWithUsage } from '@/services/catalog';
import { TextField } from '@/ui/fields';
import { Button, Card, Divider, EmptyState, ListItem, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

function TagEditor({ tag, all, onDone }: { tag: TagWithUsage; all: TagWithUsage[]; onDone: () => void }) {
  const rename = useLedgerMutation((db, name: string) => renameTag(db, tag.id, name));
  const merge = useLedgerMutation((db, target: string) => mergeTag(db, tag.id, target));
  const archive = useLedgerMutation((db, v: boolean) => setTagArchived(db, tag.id, v));
  const remove = useLedgerMutation((db, id: string) => deleteTag(db, id));
  const fail = (title: string) => (e: Error) => Alert.alert(title, e.message);
  return (
    <View style={{ padding: space.md, gap: space.sm }}>
      <RenameMerge
        kind="tag"
        name={tag.name}
        candidates={all.filter((x) => x.id !== tag.id)}
        busy={rename.isPending || merge.isPending}
        mergeNote="A transaction tagged with both keeps one tag. Amounts never change."
        onRename={(name) => rename.mutate(name, { onSuccess: onDone, onError: fail('Could not rename') })}
        onMerge={(target) => merge.mutate(target, { onSuccess: onDone, onError: fail('Could not merge') })}
      />
      <Row style={{ flexWrap: 'wrap' }}>
        <Button compact kind="secondary" icon="receipt_long" label="Transactions" onPress={() => openTransactions({ tagId: tag.id }, `#${tag.name}`)} />
        <Button
          compact
          kind="secondary"
          icon={tag.isArchived ? 'unarchive' : 'archive'}
          label={tag.isArchived ? 'Restore' : 'Archive'}
          onPress={() => archive.mutate(!tag.isArchived, { onSuccess: onDone, onError: fail('Not possible') })}
        />
        <Button
          compact
          kind="danger"
          icon="delete"
          label="Delete"
          onPress={() =>
            Alert.alert(`Delete #${tag.name}?`, 'The tag is removed from every transaction and item. No amount changes.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(tag.id, { onSuccess: onDone, onError: fail('Not possible') }) },
            ])
          }
        />
      </Row>
    </View>
  );
}

export default function TagsScreen() {
  const c = useColors();
  const { data } = useTags(true);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const add = useLedgerMutation((db, n: string) => createTag(db, { name: n }));
  if (!data) return <Loading />;
  const active = data.filter((t) => !t.isArchived);
  const archived = data.filter((t) => t.isArchived);

  const list = (tags: TagWithUsage[]) =>
    tags.map((t, i) => (
      <View key={t.id}>
        {i > 0 && <Divider inset={68} />}
        <ListItem
          icon="sell"
          iconColor={t.isArchived ? c.textFaint : (t.color ?? c.primary)}
          title={`#${t.name}`}
          subtitle={`${t.transactionCount} transaction${t.transactionCount === 1 ? '' : 's'} · ${t.itemCount} item${t.itemCount === 1 ? '' : 's'}`}
          chevron
          onPress={() => setOpen(open === t.id ? null : t.id)}
        />
        {open === t.id && <TagEditor tag={t} all={data} onDone={() => setOpen(null)} />}
      </View>
    ));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
      <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
        Tags label spending across categories (e.g. #Weekend, #Gym diet). A transaction can have several tags; totals still count it once.
      </Text>
      <Card>
        <TextField label="New tag" value={name} onChangeText={setName} placeholder="e.g. Wife snacks" autoCapitalize="sentences" />
        <Button
          compact
          icon="add"
          label="Add tag"
          disabled={!name.trim()}
          loading={add.isPending}
          onPress={() => add.mutate(name, { onSuccess: () => setName(''), onError: (e) => Alert.alert('Could not add', e.message) })}
        />
      </Card>
      <SectionHeader title={`Tags (${active.length})`} />
      {active.length === 0 ? (
        <Card>
          <EmptyState icon="sell" title="No tags yet" message="Add one above, or while recording an expense." />
        </Card>
      ) : (
        <Card padded={false}>{list(active)}</Card>
      )}
      {archived.length > 0 && (
        <>
          <SectionHeader title={`Archived (${archived.length})`} />
          <Card padded={false}>{list(archived)}</Card>
        </>
      )}
    </ScrollView>
  );
}
