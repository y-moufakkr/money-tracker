import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DATABASE_NAME } from '@/db/expo';
import { migrate } from '@/db/migrations';
import { dbFor } from '@/hooks/data';
import { Text } from '@/ui/primitives';
import { space, useColors, useNavigationTheme } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    // Data is local: never stale from the network's point of view, refreshed by invalidation after writes.
    queries: { staleTime: Infinity, retry: false, networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

async function initDatabase(sqlite: SQLiteDatabase) {
  await sqlite.execAsync('PRAGMA journal_mode = WAL');
  await migrate(dbFor(sqlite));
}

function HideSplash() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);
  return null;
}

function StartupError({ error }: { error: Error }) {
  const c = useColors();
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.xl, paddingTop: 80, gap: space.md }}>
      <Text variant="title">Your data could not be opened</Text>
      <Text tone="muted">
        Nothing has been changed or deleted. Please keep this screen and share the message below when reporting the problem.
      </Text>
      <View style={{ backgroundColor: c.surfaceAlt, padding: space.md, borderRadius: 8 }}>
        <Text variant="caption">{error.message}</Text>
      </View>
    </ScrollView>
  );
}

export default function RootLayout() {
  const theme = useNavigationTheme();
  const c = useColors();
  const [error, setError] = useState<Error | null>(null);

  const modal = { presentation: 'modal' as const, headerShadowVisible: false };

  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="auto" />
        {error ? (
          <StartupError error={error} />
        ) : (
          <SQLiteProvider databaseName={DATABASE_NAME} onInit={initDatabase} onError={setError}>
            <QueryClientProvider client={queryClient}>
              <HideSplash />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: c.bg },
                  headerTintColor: c.text,
                  headerShadowVisible: false,
                  contentStyle: { backgroundColor: c.bg },
                }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="add"
                  options={{ presentation: 'transparentModal', animation: 'fade', headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}
                />
                <Stack.Screen name="entry/expense" options={{ ...modal, title: 'Expense' }} />
                <Stack.Screen name="entry/income" options={{ ...modal, title: 'Income' }} />
                <Stack.Screen name="entry/transfer" options={{ ...modal, title: 'Transfer' }} />
                <Stack.Screen name="accounts/new" options={{ ...modal, title: 'New money location' }} />
                <Stack.Screen name="accounts/[id]/index" options={{ title: '' }} />
                <Stack.Screen name="accounts/[id]/edit" options={{ ...modal, title: 'Edit location' }} />
                <Stack.Screen name="accounts/[id]/reconcile" options={{ ...modal, title: 'Check balance' }} />
                <Stack.Screen name="accounts/[id]/card" options={{ ...modal, title: 'Add card' }} />
                <Stack.Screen name="accounts/pick" options={{ ...modal, title: 'Choose a location' }} />
                <Stack.Screen name="transactions/[id]" options={{ title: 'Transaction' }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                <Stack.Screen name="goals/edit" options={{ ...modal, title: 'Goal' }} />
                <Stack.Screen name="goals/[id]" options={{ title: 'Goal' }} />
                <Stack.Screen name="budgets/index" options={{ title: 'Budgets' }} />
                <Stack.Screen name="budgets/edit" options={{ ...modal, title: 'Budget' }} />
                <Stack.Screen name="products/index" options={{ title: 'Products & prices' }} />
                <Stack.Screen name="products/[id]" options={{ title: 'Product' }} />
                <Stack.Screen name="merchants/index" options={{ title: 'Merchants' }} />
                <Stack.Screen name="merchants/[id]" options={{ title: 'Merchant' }} />
                <Stack.Screen name="categories/index" options={{ title: 'Categories' }} />
                <Stack.Screen name="categories/edit" options={{ ...modal, title: 'Category' }} />
                <Stack.Screen name="tags" options={{ title: 'Tags' }} />
                <Stack.Screen name="trends" options={{ title: 'Balance trends' }} />
              </Stack>
            </QueryClientProvider>
          </SQLiteProvider>
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
