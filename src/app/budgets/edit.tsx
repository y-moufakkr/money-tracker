import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { addDays, todayISO } from '@/domain/dates';
import { minorToInput, parseAmount } from '@/domain/money';
import type { Budget, BudgetPeriod } from '@/domain/types';
import { useAllCategories, useBudget, useLedgerMutation } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { DEFAULT_THRESHOLDS, deleteBudget, saveBudget, type BudgetInput } from '@/services/budgets';
import { ChipGroup, DateButton, Field, TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Button, Chip, EmptyState, IconButton, Loading, Row, SectionHeader, Segmented, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const THRESHOLD_CHOICES = [50, 75, 80, 90, 100, 110];

type LineDraft = { categoryId: string; amount: string };

export default function BudgetEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const budget = useBudget(id);
  const categories = useAllCategories('expense').data;
  if ((id && budget.isLoading) || !categories) return <Loading />;
  if (id && !budget.data) return <EmptyState icon="error" title="Budget not found" />;
  return <BudgetForm budget={budget.data ?? null} categories={categories} />;
}

function BudgetForm({ budget, categories }: { budget: Budget | null; categories: NonNullable<ReturnType<typeof useAllCategories>['data']> }) {
  const c = useColors();
  const today = todayISO();
  const [name, setName] = useState(budget?.name ?? 'Monthly budget');
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? 'monthly');
  const [startDate, setStartDate] = useState(budget?.startDate ?? today);
  const [endDate, setEndDate] = useState(budget?.endDate ?? addDays(today, 29));
  const [amount, setAmount] = useState(budget?.amountMinor ? minorToInput(budget.amountMinor) : '');
  const [thresholds, setThresholds] = useState<number[]>(budget?.thresholds ?? DEFAULT_THRESHOLDS);
  const [lines, setLines] = useState<LineDraft[]>(
    budget?.lines.map((l) => ({ categoryId: l.categoryId, amount: minorToInput(l.amountMinor) })) ?? [],
  );
  const [picking, setPicking] = useState(false);

  const save = useLedgerMutation((db, v: { id: string | null; input: BudgetInput }) => saveBudget(db, v.input, v.id));
  const remove = useLedgerMutation((db, budgetId: string) => deleteBudget(db, budgetId));

  const amountMinor = amount.trim() ? parseAmount(amount) : null;
  const parsedLines = lines.map((l) => ({ categoryId: l.categoryId, amountMinor: l.amount.trim() ? parseAmount(l.amount) : null }));
  const linesTotal = parsedLines.reduce((s, l) => s + (l.amountMinor ?? 0), 0);
  const byId = new Map(categories.map((x) => [x.id, x]));
  const label = (id: string) => {
    const cat = byId.get(id);
    const parent = cat?.parentId ? byId.get(cat.parentId) : null;
    return parent ? `${parent.name} › ${cat?.name}` : (cat?.name ?? 'Category');
  };
  const available = categories.filter((x) => !x.isArchived && !lines.some((l) => l.categoryId === x.id));

  const submit = () => {
    if (amount.trim() && amountMinor === null) {
      Alert.alert('Check the overall limit', 'Enter an amount or leave it empty to use the sum of the category limits.');
      return;
    }
    const bad = parsedLines.find((l) => l.amountMinor === null || l.amountMinor <= 0);
    if (bad) {
      Alert.alert('Check the category limits', `${label(bad.categoryId)} needs an amount.`);
      return;
    }
    save.mutate(
      {
        id: budget?.id ?? null,
        input: {
          name,
          period,
          startDate,
          endDate,
          amountMinor,
          thresholds,
          lines: parsedLines.map((l) => ({ categoryId: l.categoryId, amountMinor: l.amountMinor! })),
        },
      },
      { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Could not save', e.message) },
    );
  };

  const confirmDelete = (id: string) =>
    Alert.alert('Delete this budget?', 'Only the plan is removed. Your transactions are not touched.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => remove.mutate(id, { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Not possible', e.message) }),
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: budget ? 'Edit budget' : 'New budget' }} />
      <FormScreen footer={<Button label="Save" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />}>
        <TextField label="Name" value={name} onChangeText={setName} />
        <Field label="Period">
          <Segmented
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'custom', label: 'Custom dates' },
            ]}
            value={period}
            onChange={setPeriod}
          />
        </Field>
        {period === 'custom' && (
          <Field label="Dates">
            <Row style={{ flexWrap: 'wrap' }}>
              <DateButton label="From" value={startDate} onChange={setStartDate} maximumDate="2100-12-31" />
              <DateButton label="To" value={endDate} onChange={setEndDate} minimumDate={startDate} maximumDate="2100-12-31" />
            </Row>
          </Field>
        )}
        <TextField
          label="Total spending limit"
          hint={lines.length ? `Optional. Empty = sum of category limits (${minorToInput(linesTotal)} DH).` : 'All personal spending in the period.'}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="e.g. 8000"
          error={amount.trim() && amountMinor === null ? 'Not a valid amount' : null}
        />
        {amountMinor !== null && linesTotal > amountMinor && (
          <Text variant="caption" color={c.warning} style={{ marginTop: -space.sm, marginBottom: space.md }}>
            Category limits add up to more than the total limit.
          </Text>
        )}
        <Field label="Warn me at" hint="Percent of the limit used">
          <ChipGroup>
            {THRESHOLD_CHOICES.map((t) => (
              <Chip
                key={t}
                label={`${t}%`}
                selected={thresholds.includes(t)}
                onPress={() =>
                  setThresholds((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t].sort((a, b) => a - b)))
                }
              />
            ))}
          </ChipGroup>
        </Field>

        <SectionHeader title="Category limits (optional)" />
        <Text variant="caption" tone="muted" style={{ marginBottom: space.sm }}>
          A limit covers the category and its subcategories, unless a subcategory has its own limit. Everything else counts toward “other”.
        </Text>
        <View style={{ gap: space.sm }}>
          {lines.map((l, i) => (
            <Row key={l.categoryId}>
              <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                {label(l.categoryId)}
              </Text>
              <View style={{ width: 130 }}>
                <TextField
                  value={l.amount}
                  onChangeText={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: v } : x)))}
                  keyboardType="decimal-pad"
                  placeholder="DH"
                  accessibilityLabel={`${label(l.categoryId)} limit`}
                />
              </View>
              <IconButton icon="close" label="Remove limit" onPress={() => setLines(lines.filter((_, j) => j !== i))} />
            </Row>
          ))}
        </View>
        {picking ? (
          <Field label="Choose a category">
            <ChipGroup>
              {available.map((cat) => (
                <Chip
                  key={cat.id}
                  label={label(cat.id)}
                  icon={cat.icon ?? undefined}
                  color={cat.color ?? undefined}
                  onPress={() => {
                    setLines([...lines, { categoryId: cat.id, amount: '' }]);
                    setPicking(false);
                  }}
                />
              ))}
            </ChipGroup>
          </Field>
        ) : (
          <Button compact kind="secondary" icon="add" label="Add category limit" onPress={() => setPicking(true)} style={{ alignSelf: 'flex-start', marginBottom: space.lg }} />
        )}
        {budget && <Button kind="danger" icon="delete" label="Delete budget" onPress={() => confirmDelete(budget.id)} loading={remove.isPending} />}
      </FormScreen>
    </>
  );
}
