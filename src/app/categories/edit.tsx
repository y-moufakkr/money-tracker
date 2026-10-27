import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { RenameMerge } from '@/components/rename-merge';
import type { CategoryKind } from '@/domain/types';
import { useAllCategories, useLedgerMutation } from '@/hooks/data';
import { openTransactions } from '@/lib/drill';
import { closeScreen } from '@/lib/navigation';
import {
  createCategory,
  mergeCategory,
  setCategoryArchived,
  updateCategory,
  type CategoryInput,
  type CategoryWithUsage,
} from '@/services/catalog';
import { ChipGroup, Field, TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Banner, Button, Chip, EmptyState, Loading, SectionHeader, Segmented } from '@/ui/primitives';
import { SERIES, space } from '@/ui/theme';

const ICONS = [
  'shopping_cart', 'restaurant', 'local_cafe', 'cookie', 'local_gas_station', 'directions_bus', 'bolt', 'wifi', 'medical_services',
  'child_care', 'checkroom', 'fitness_center', 'movie', 'home_repair_service', 'redeem', 'pets', 'school', 'label',
];

type Essential = 'yes' | 'no' | 'unset';

export default function CategoryEditScreen() {
  const params = useLocalSearchParams<{ id?: string; kind?: CategoryKind }>();
  const expense = useAllCategories('expense').data;
  const income = useAllCategories('income').data;
  if (!expense || !income) return <Loading />;
  const all = [...expense, ...income];
  const category = params.id ? all.find((x) => x.id === params.id) : null;
  if (params.id && !category) return <EmptyState icon="error" title="Category not found" message="It may have been merged." />;
  const kind = category?.kind ?? params.kind ?? 'expense';
  return <CategoryForm category={category ?? null} kind={kind} siblings={kind === 'expense' ? expense : income} />;
}

function CategoryForm({ category, kind, siblings }: { category: CategoryWithUsage | null; kind: CategoryKind; siblings: CategoryWithUsage[] }) {
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState<string | null>(category?.parentId ?? null);
  const [essential, setEssential] = useState<Essential>(category?.essential === null || !category ? 'unset' : category.essential ? 'yes' : 'no');
  const [icon, setIcon] = useState(category?.icon ?? 'label');
  const [color, setColor] = useState(category?.color ?? SERIES[0]);

  const save = useLedgerMutation(async (db, v: { id: string | null; input: CategoryInput }) => {
    if (v.id) await updateCategory(db, v.id, v.input);
    else await createCategory(db, v.input);
  });
  const archive = useLedgerMutation((db, v: { id: string; archived: boolean }) => setCategoryArchived(db, v.id, v.archived));
  const merge = useLedgerMutation((db, v: { id: string; target: string }) => mergeCategory(db, v.id, v.target));

  // Closures only capture this local: React Compiler would otherwise read `category.id` outside the null guard.
  const categoryId = category?.id ?? null;
  const hasChildren = categoryId !== null && siblings.some((x) => x.parentId === categoryId);
  const parentOptions = siblings.filter((x) => !x.parentId && !x.isArchived && x.id !== categoryId);

  const submit = () =>
    save.mutate(
      { id: categoryId, input: { name, kind, parentId, icon, color, essential: essential === 'unset' ? null : essential === 'yes' } },
      { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Could not save', e.message) },
    );

  return (
    <>
      <Stack.Screen options={{ title: category ? 'Edit category' : `New ${kind} category` }} />
      <FormScreen footer={<Button label="Save" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />}>
        <TextField label="Name" value={name} onChangeText={setName} autoFocus={!category} autoCapitalize="sentences" />
        <Field label="Parent" hint={hasChildren ? 'This category has subcategories, so it stays at the top level.' : 'Make it a subcategory of…'}>
          <ChipGroup>
            <Chip label="None (top level)" selected={parentId === null} onPress={() => setParentId(null)} />
            {!hasChildren &&
              parentOptions.map((p) => (
                <Chip key={p.id} label={p.name} icon={p.icon ?? undefined} color={p.color ?? undefined} selected={parentId === p.id} onPress={() => setParentId(p.id)} />
              ))}
          </ChipGroup>
        </Field>
        {kind === 'expense' && (
          <Field label="Spending type" hint="Used for the essential vs discretionary split. “Not set” inherits from the parent.">
            <Segmented
              options={[
                { value: 'yes', label: 'Essential' },
                { value: 'no', label: 'Discretionary' },
                { value: 'unset', label: 'Not set' },
              ]}
              value={essential}
              onChange={setEssential}
            />
          </Field>
        )}
        <Field label="Icon">
          <ChipGroup>
            {ICONS.map((i) => (
              <Chip key={i} label="" accessibilityLabel={`Icon ${i.replace(/_/g, ' ')}`} icon={i} color={color} selected={icon === i} onPress={() => setIcon(i)} />
            ))}
          </ChipGroup>
        </Field>
        <Field label="Colour">
          <ChipGroup>
            {SERIES.map((s) => (
              <Chip key={s} label="●" accessibilityLabel={`Colour ${s}`} color={s} selected={color === s} onPress={() => setColor(s)} />
            ))}
          </ChipGroup>
        </Field>

        {category && (
          <View style={{ gap: space.md }}>
            <Button
              kind="ghost"
              icon="receipt_long"
              label={`Show ${category.useCount} transaction${category.useCount === 1 ? '' : 's'}`}
              onPress={() => openTransactions({ categoryId: category.id, includeSubcategories: true }, category.name)}
            />
            <SectionHeader title="Archive or merge" />
            {category.isSystem ? (
              <Banner tone="info">This built-in category is used by the app (e.g. for transfer fees). You can rename it, but not archive or merge it.</Banner>
            ) : (
              <>
                <Button
                  kind="secondary"
                  icon={category.isArchived ? 'unarchive' : 'archive'}
                  label={category.isArchived ? 'Restore category' : `Archive${hasChildren ? ' (with subcategories)' : ''}`}
                  loading={archive.isPending}
                  onPress={() => archive.mutate({ id: category.id, archived: !category.isArchived }, { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Not possible', e.message) })}
                />
                <RenameMerge
                  kind="category"
                  name={category.name}
                  mergeOnly
                  candidates={siblings.filter((x) => x.id !== category.id && x.parentId !== category.id && !x.isArchived)}
                  busy={merge.isPending}
                  mergeNote="Transactions, items, budget limits and subcategories move too. Amounts and dates are unchanged."
                  onRename={() => undefined}
                  onMerge={(target) =>
                    merge.mutate({ id: category.id, target }, {
                      onSuccess: () => router.replace(`/categories/edit?id=${target}`),
                      onError: (e) => Alert.alert('Could not merge', e.message),
                    })
                  }
                />
              </>
            )}
          </View>
        )}
      </FormScreen>
    </>
  );
}
