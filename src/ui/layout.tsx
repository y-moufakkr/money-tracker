import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './icon';
import { Text } from './primitives';
import { radius, space, useColors } from './theme';

/** Room left at the bottom of tab screens for the FAB. */
export const FAB_CLEARANCE = 96;

/** A top-level tab screen: large title header + scrolling content. */
export function TabScreen({
  title,
  subtitle,
  headerRight,
  children,
  refreshing,
  onRefresh,
  fab = true,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  fab?: boolean;
  scroll?: boolean;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const header = (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        {subtitle && (
          <Text variant="label" tone="muted">
            {subtitle}
          </Text>
        )}
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
      </View>
      {headerRight}
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[c.primary]} />
            ) : undefined
          }>
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: space.lg }}>{header}</View>
          {children}
        </View>
      )}
      {fab && <Fab />}
    </View>
  );
}

/** Scrollable form body with a pinned action bar that stays above the keyboard. */
export function FormScreen({
  children,
  footer,
  scrollProps,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scrollProps?: ScrollViewProps;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: space.lg }]}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}>
        {children}
      </ScrollView>
      {footer && (
        <View
          style={[
            styles.footer,
            { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, space.md) },
          ]}>
          {footer}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

export function Fab() {
  const c = useColors();
  return (
    <Pressable
      onPress={() => router.push('/add')}
      accessibilityRole="button"
      accessibilityLabel="Add expense, income or transfer"
      android_ripple={{ color: '#ffffff44', borderless: false }}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: c.primary, bottom: space.lg },
        pressed && { transform: [{ scale: 0.96 }] },
      ]}>
      <Icon name="add" size={30} color={c.onPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: space.md,
  },
  fab: {
    position: 'absolute',
    right: space.lg,
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    overflow: 'hidden',
  },
});
