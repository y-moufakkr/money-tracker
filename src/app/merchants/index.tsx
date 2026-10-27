import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';

import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useMerchants } from '@/hooks/data';
import { TextField } from '@/ui/fields';
import { Icon } from '@/ui/icon';
import { Amount, Divider, EmptyState, ListItem, Loading, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function MerchantsScreen() {
  const c = useColors();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useMerchants(search);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}
      keyboardShouldPersistTaps="handled"
      data={data ?? []}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={
        <View>
          <TextField
            placeholder="Search merchants"
            value={search}
            onChangeText={setSearch}
            leading={<Icon name="search" size={20} color={c.textFaint} />}
          />
          <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
            Personal spending, all time. Sorted by total spent.
          </Text>
        </View>
      }
      ListEmptyComponent={
        isLoading ? <Loading /> : <EmptyState icon="store" title={search ? 'No merchant matches' : 'No merchants yet'} />
      }
      ItemSeparatorComponent={() => <Divider inset={68} />}
      renderItem={({ item: m }) => (
        <View style={{ backgroundColor: c.surface }}>
          <ListItem
            icon="store"
            iconColor={m.isArchived ? c.textFaint : c.primary}
            title={m.isArchived ? `${m.name} (archived)` : m.name}
            subtitle={[
              `${m.visits} visit${m.visits === 1 ? '' : 's'}`,
              m.averageTicketMinor !== null ? `avg ${formatMoney(m.averageTicketMinor)}` : null,
              m.lastVisit ? formatDateLabel(m.lastVisit) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            right={<Amount minor={m.totalMinor} variant="label" />}
            chevron
            onPress={() => router.push(`/merchants/${m.id}`)}
          />
        </View>
      )}
    />
  );
}
