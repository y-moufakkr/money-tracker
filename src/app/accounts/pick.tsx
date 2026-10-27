import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { AccountRow } from '@/components/account-row';
import { useAccountBalances } from '@/hooks/data';
import { Card, Divider, EmptyState, Loading, SectionHeader } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

/** Chooses a location, then continues to `next` (currently only "reconcile"). */
export default function PickAccountScreen() {
  const c = useColors();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { data, isLoading } = useAccountBalances();
  if (isLoading || !data) return <Loading />;
  if (data.length === 0) {
    return (
      <EmptyState
        icon="account_balance_wallet"
        title="No money locations yet"
        action={{ label: 'Add location', onPress: () => router.replace('/accounts/new') }}
      />
    );
  }

  const go = (id: string) => router.replace(next === 'reconcile' ? `/accounts/${id}/reconcile` : `/accounts/${id}`);
  const groups = [
    { title: 'Personal', items: data.filter((a) => a.ownership === 'personal') },
    { title: 'Company', items: data.filter((a) => a.ownership === 'business') },
  ].filter((g) => g.items.length > 0);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg }}>
      {groups.map((g) => (
        <View key={g.title}>
          <SectionHeader title={g.title} />
          <Card padded={false}>
            {g.items.map((a, i) => (
              <View key={a.id}>
                {i > 0 && <Divider inset={68} />}
                <AccountRow account={a} onPress={() => go(a.id)} />
              </View>
            ))}
          </Card>
        </View>
      ))}
    </ScrollView>
  );
}
