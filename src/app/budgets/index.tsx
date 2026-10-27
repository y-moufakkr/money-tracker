import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { BudgetCard } from '@/components/budget-card';
import { useBudgetStatuses } from '@/hooks/data';
import { Button, Card, EmptyState, Loading, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function BudgetsScreen() {
  const c = useColors();
  const { data, isLoading } = useBudgetStatuses();
  if (isLoading || !data) return <Loading />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64, gap: space.md }}>
      {data.length === 0 ? (
        <Card>
          <EmptyState
            icon="savings"
            title="No budgets yet"
            message="Set a total monthly limit (e.g. 8,000 DH) and optional limits per category. Warnings appear at 75%, 90% and 100% by default."
            action={{ label: 'Create a budget', onPress: () => router.push('/budgets/edit') }}
          />
        </Card>
      ) : (
        data.map((s) => (
          <View key={s.budget.id} style={{ gap: space.xs }}>
            <BudgetCard status={s} detailed />
            <Button compact kind="ghost" icon="edit" label={`Edit ${s.budget.name}`} onPress={() => router.push(`/budgets/edit?id=${s.budget.id}`)} />
          </View>
        ))
      )}
      {data.length > 0 && <Button kind="secondary" icon="add" label="New budget" onPress={() => router.push('/budgets/edit')} />}
      <Text variant="caption" tone="muted">
        Budgets are plans: spending is always taken from your recorded personal expenses, and editing a budget never changes a transaction.
        A category limit includes its subcategories unless they have their own limit. Tap a category to see its transactions.
      </Text>
    </ScrollView>
  );
}
