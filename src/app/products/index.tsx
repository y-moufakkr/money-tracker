import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';

import { formatDateLabel } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useProducts } from '@/hooks/data';
import { TextField } from '@/ui/fields';
import { Icon } from '@/ui/icon';
import { Divider, EmptyState, ListItem, Loading, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function ProductsScreen() {
  const c = useColors();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useProducts(search);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }}
      keyboardShouldPersistTaps="handled"
      data={data ?? []}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={
        <View>
          <TextField
            placeholder="Search products"
            value={search}
            onChangeText={setSearch}
            leading={<Icon name="search" size={20} color={c.textFaint} />}
          />
          <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
            Products are added when you itemise a purchase. Prices are per kg, L or piece when the recorded units allow it.
          </Text>
        </View>
      }
      ListEmptyComponent={
        isLoading ? (
          <Loading />
        ) : (
          <EmptyState
            icon="shopping_basket"
            title={search ? 'No product matches' : 'No products yet'}
            message={search ? undefined : 'Add items to an expense (“Add items, note…”) to start a price history.'}
          />
        )
      }
      ItemSeparatorComponent={() => <Divider inset={68} />}
      renderItem={({ item: p }) => (
        <View style={{ backgroundColor: c.surface }}>
          <ListItem
            icon="shopping_basket"
            iconColor={c.primary}
            title={p.name}
            subtitle={[
              `${p.purchaseCount} purchase${p.purchaseCount === 1 ? '' : 's'}`,
              p.lastDate ? `last ${formatDateLabel(p.lastDate)}` : null,
              p.totalSpentMinor ? formatMoney(p.totalSpentMinor) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            right={
              p.latestPrice ? (
                <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>
                  {formatMoney(p.latestPrice.priceMinor)}/{p.latestPrice.unitLabel}
                </Text>
              ) : undefined
            }
            chevron
            onPress={() => router.push(`/products/${p.id}`)}
          />
        </View>
      )}
    />
  );
}
