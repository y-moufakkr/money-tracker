import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { CategoryKind } from '@/domain/types';
import { useAllCategories } from '@/hooks/data';
import type { CategoryWithUsage } from '@/services/catalog';
import { Button, Card, Divider, ListItem, Loading, SectionHeader, Segmented, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const ESSENTIAL_LABEL = (e: boolean | null) => (e === null ? null : e ? 'Essential' : 'Discretionary');

function CategoryItem({ cat, child, parentEssential }: { cat: CategoryWithUsage; child?: boolean; parentEssential?: boolean | null }) {
  const c = useColors();
  const essential = ESSENTIAL_LABEL(cat.essential) ?? (child && parentEssential !== null && parentEssential !== undefined ? `${ESSENTIAL_LABEL(parentEssential)} (inherited)` : null);
  return (
    <View style={{ paddingLeft: child ? space.xl : 0 }}>
      <ListItem
        icon={cat.icon ?? 'label'}
        iconColor={cat.isArchived ? c.textFaint : (cat.color ?? c.textMuted)}
        title={cat.name}
        subtitle={[`${cat.useCount} transaction${cat.useCount === 1 ? '' : 's'}`, essential, cat.isSystem ? 'built-in' : null].filter(Boolean).join(' · ')}
        chevron
        onPress={() => router.push(`/categories/edit?id=${cat.id}`)}
      />
    </View>
  );
}

export default function CategoriesScreen() {
  const c = useColors();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const { data } = useAllCategories(kind);
  if (!data) return <Loading />;
  const active = data.filter((x) => !x.isArchived);
  const parents = active.filter((x) => !x.parentId || !active.some((p) => p.id === x.parentId));
  const archived = data.filter((x) => x.isArchived);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}>
      <Segmented
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
        ]}
        value={kind}
        onChange={setKind}
      />
      <Button
        kind="secondary"
        icon="add"
        label={`New ${kind} category`}
        onPress={() => router.push(`/categories/edit?kind=${kind}`)}
        style={{ marginTop: space.md }}
      />
      <Text variant="caption" tone="muted" style={{ marginTop: space.md }}>
        Group categories with subcategories (one level). Analytics roll subcategories into their parent and can show them separately.
      </Text>
      <SectionHeader title={`Active (${active.length})`} />
      <Card padded={false}>
        {parents.map((p, i) => (
          <View key={p.id}>
            {i > 0 && <Divider inset={68} />}
            <CategoryItem cat={p} />
            {active
              .filter((x) => x.parentId === p.id)
              .map((child) => (
                <View key={child.id}>
                  <Divider inset={68 + space.xl} />
                  <CategoryItem cat={child} child parentEssential={p.essential} />
                </View>
              ))}
          </View>
        ))}
      </Card>
      {archived.length > 0 && (
        <>
          <SectionHeader title={`Archived (${archived.length})`} />
          <Card padded={false}>
            {archived.map((x, i) => (
              <View key={x.id}>
                {i > 0 && <Divider inset={68} />}
                <CategoryItem cat={x} />
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
