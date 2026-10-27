import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { closeScreen } from '@/lib/navigation';
import { IconBadge, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const ACTIONS: { icon: string; label: string; hint: string; href: Href; tone: 'negative' | 'positive' | 'primary' | 'warning' | 'muted' }[] = [
  { icon: 'remove', label: 'Expense', hint: 'Money spent', href: '/entry/expense', tone: 'negative' },
  { icon: 'document_scanner', label: 'Scan receipt', hint: 'Photo → expense', href: '/scan?from=camera', tone: 'negative' },
  { icon: 'add', label: 'Income', hint: 'Money received', href: '/entry/income', tone: 'positive' },
  { icon: 'swap_horiz', label: 'Transfer', hint: 'Move between locations', href: '/entry/transfer', tone: 'primary' },
  { icon: 'add_card', label: 'Money location', hint: 'Bank, cash, card…', href: '/accounts/new', tone: 'muted' },
  { icon: 'balance', label: 'Check a balance', hint: 'Reconcile with reality', href: '/accounts/pick?next=reconcile', tone: 'warning' },
];

/** Bottom action sheet opened by the "+" button. */
export default function AddSheet() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const tint = { negative: c.negative, positive: c.positive, primary: c.primary, warning: c.warning, muted: c.textMuted };

  return (
    <View style={styles.root}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} onPress={() => closeScreen()} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + space.lg }]}>
        <View style={[styles.handle, { backgroundColor: c.border }]} />
        <Text variant="heading" style={{ marginBottom: space.sm, paddingHorizontal: space.lg }}>
          Add
        </Text>
        <View style={styles.grid}>
          {ACTIONS.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => router.replace(a.href)}
              android_ripple={{ color: c.border }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, { backgroundColor: pressed ? c.surfaceAlt : c.bg }]}>
              <IconBadge icon={a.icon} color={tint[a.tone]} size={44} />
              <Text variant="bodyStrong">{a.label}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {a.hint}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.sm },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg },
  action: { flexBasis: '48%', flexGrow: 1, padding: space.md, borderRadius: radius.lg, gap: 4, overflow: 'hidden' },
});
