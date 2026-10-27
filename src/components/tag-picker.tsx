import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import { useLedgerMutation, useTags } from '@/hooks/data';
import { createTag } from '@/services/catalog';
import { ChipGroup, Field } from '@/ui/fields';
import { Chip, Row } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** Multi-select tags with inline creation. Archived tags stay visible only when already selected. */
export function TagPicker({
  value,
  onChange,
  label = 'Tags',
  compact,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  compact?: boolean;
}) {
  const c = useColors();
  const tags = useTags(true).data ?? [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const create = useLedgerMutation((db, n: string) => createTag(db, { name: n }));
  const visible = tags.filter((t) => !t.isArchived || value.includes(t.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const submit = () => {
    if (!name.trim()) {
      setAdding(false);
      return;
    }
    create.mutate(name, {
      onSuccess: (id) => {
        if (!value.includes(id)) onChange([...value, id]);
        setName('');
        setAdding(false);
      },
      onError: (e) => Alert.alert('Could not add tag', e.message),
    });
  };

  const body = (
    <ChipGroup>
      {visible.map((t) => (
        <Chip key={t.id} label={`#${t.name}`} selected={value.includes(t.id)} onPress={() => toggle(t.id)} color={t.color ?? undefined} />
      ))}
      {adding ? (
        <Row gap={space.xs}>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            placeholder="New tag"
            placeholderTextColor={c.textFaint}
            onSubmitEditing={submit}
            onBlur={submit}
            returnKeyType="done"
            accessibilityLabel="New tag name"
            style={{
              minWidth: 120,
              minHeight: 36,
              borderWidth: 1,
              borderColor: c.primary,
              borderRadius: radius.pill,
              paddingHorizontal: space.md,
              color: c.text,
              fontSize: 13,
            }}
          />
        </Row>
      ) : (
        <Chip label="New tag" icon="add" onPress={() => setAdding(true)} />
      )}
    </ChipGroup>
  );
  if (compact) return <View>{body}</View>;
  return <Field label={label}>{body}</Field>;
}
