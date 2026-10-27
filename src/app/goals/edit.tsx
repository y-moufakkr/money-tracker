import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { addMonths, todayISO } from '@/domain/dates';
import { BASE_CURRENCY, minorToInput, parseAmount } from '@/domain/money';
import type { SavingsGoal } from '@/domain/types';
import { useGoal, useLedgerMutation } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { createGoal, deleteGoal, updateGoal, type GoalInput } from '@/services/goals';
import { AmountInput, ChipGroup, DateButton, Field, TextField, Toggle } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Button, Chip, EmptyState, Loading } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

const ICONS = ['savings', 'health_and_safety', 'pregnant_woman', 'child_care', 'car_repair', 'flight', 'home_repair_service', 'school', 'flag'];
const PRESETS = ['Emergency fund', 'Maternity', 'Car maintenance', 'Family holiday', 'House repairs'];

export default function GoalEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const goal = useGoal(id);
  if (id && goal.isLoading) return <Loading />;
  if (id && !goal.data) return <EmptyState icon="error" title="Goal not found" />;
  return <GoalForm goal={goal.data ?? null} />;
}

function GoalForm({ goal }: { goal: SavingsGoal | null }) {
  const c = useColors();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? minorToInput(goal.targetMinor) : '');
  const [hasDate, setHasDate] = useState(!!goal?.targetDate);
  const [date, setDate] = useState(goal?.targetDate ?? addMonths(todayISO(), 12));
  const [plan, setPlan] = useState(goal?.monthlyPlanMinor ? minorToInput(goal.monthlyPlanMinor) : '');
  const [icon, setIcon] = useState(goal?.icon ?? 'savings');
  const [notes, setNotes] = useState(goal?.notes ?? '');

  // The id travels in the input: React Compiler would otherwise read `goal.id` during render.
  const save = useLedgerMutation(async (db, v: { id: string | null; input: GoalInput }) => {
    if (v.id) await updateGoal(db, v.id, v.input);
    else await createGoal(db, v.input);
  });
  const remove = useLedgerMutation((db, goalId: string) => deleteGoal(db, goalId));

  const targetMinor = target.trim() ? parseAmount(target) : null;
  const planMinor = plan.trim() ? parseAmount(plan) : null;

  const submit = () => {
    if (!targetMinor) {
      Alert.alert('Enter a target', 'How much do you want to set aside?');
      return;
    }
    if (plan.trim() && !planMinor) {
      Alert.alert('Check the monthly contribution', 'Enter an amount or leave it empty.');
      return;
    }
    save.mutate(
      { id: goal?.id ?? null, input: { name, targetMinor, targetDate: hasDate ? date : null, monthlyPlanMinor: planMinor, icon, notes } },
      { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Could not save', e.message) },
    );
  };

  const confirmDelete = (id: string) =>
    Alert.alert('Delete this goal?', 'Its reservations are released. No money moves and no transaction changes.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => remove.mutate(id, { onSuccess: () => closeScreen(), onError: (e) => Alert.alert('Not possible', e.message) }),
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: goal ? 'Edit goal' : 'New goal' }} />
      <FormScreen footer={<Button label="Save" icon="check" onPress={submit} loading={save.isPending} style={{ flex: 1 }} />}>
        <AmountInput value={target} onChangeText={setTarget} currency={BASE_CURRENCY} autoFocus={!goal} accessibilityLabel="Target amount" />
        <TextField label="Goal name" value={name} onChangeText={setName} placeholder="e.g. Emergency fund" autoCapitalize="sentences" />
        {!goal && !name && (
          <Field>
            <ChipGroup>
              {PRESETS.map((p) => (
                <Chip key={p} label={p} onPress={() => setName(p)} />
              ))}
            </ChipGroup>
          </Field>
        )}
        <Field label="Icon">
          <ChipGroup>
            {ICONS.map((i) => (
              <Chip key={i} label="" accessibilityLabel={`Icon ${i.replace(/_/g, ' ')}`} icon={i} selected={icon === i} onPress={() => setIcon(i)} />
            ))}
          </ChipGroup>
        </Field>
        <Toggle label="Target date" description="Shows how much you need to reserve each month" value={hasDate} onChange={setHasDate} />
        {hasDate && (
          <Field>
            <DateButton value={date} onChange={setDate} minimumDate={todayISO()} maximumDate="2100-12-31" label="By" />
          </Field>
        )}
        <TextField
          label="Planned monthly contribution (optional)"
          value={plan}
          onChangeText={setPlan}
          keyboardType="decimal-pad"
          placeholder="e.g. 1000"
          trailing={<Chip label="DH" color={c.textMuted} />}
        />
        <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        {goal && <Button kind="danger" icon="delete" label="Delete goal" onPress={() => confirmDelete(goal.id)} loading={remove.isPending} />}
      </FormScreen>
    </>
  );
}
