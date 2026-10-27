import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { formatMoney } from '@/domain/money';
import { Icon } from './icon';
import { radius, space, useColors, type Colors } from './theme';

// ---------------------------------------------------------------------------
// Text

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'label' | 'caption' | 'overline';

const variants: Record<Variant, TextStyle> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
};

export function Text({
  variant = 'body',
  color,
  tone,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string; tone?: 'muted' | 'faint' }) {
  const c = useColors();
  const resolved = color ?? (tone === 'muted' ? c.textMuted : tone === 'faint' ? c.textFaint : c.text);
  return <RNText style={[variants[variant], { color: resolved }, style]} {...rest} />;
}

/** Money with tabular digits. `colored` paints negatives red and (optionally) positives green. */
export function Amount({
  minor,
  currency,
  variant = 'bodyStrong',
  sign,
  colored,
  color,
  style,
}: {
  minor: number;
  currency?: string;
  variant?: Variant;
  sign?: 'auto' | 'always' | 'never';
  colored?: boolean | 'negative-only';
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const c = useColors();
  let tint = color;
  if (!tint && colored) {
    if (minor < 0) tint = c.negative;
    else if (minor > 0 && colored === true) tint = c.positive;
  }
  return (
    <Text variant={variant} color={tint} style={[{ fontVariant: ['tabular-nums'] }, style]} numberOfLines={1}>
      {formatMoney(minor, currency, { sign })}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Containers

export function Card({
  children,
  style,
  tone,
  onPress,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'primary' | 'business' | 'estimate' | 'warning' | 'danger';
  onPress?: () => void;
  padded?: boolean;
}) {
  const c = useColors();
  const toneStyle: ViewStyle = (() => {
    switch (tone) {
      case 'primary':
        return { backgroundColor: c.primarySoft, borderColor: 'transparent' };
      case 'business':
        return { backgroundColor: c.businessSoft, borderColor: 'transparent' };
      case 'estimate':
        return { backgroundColor: c.estimateSoft, borderColor: c.estimate, borderStyle: 'dashed' };
      case 'warning':
        return { backgroundColor: c.warningSoft, borderColor: 'transparent' };
      case 'danger':
        return { backgroundColor: c.negativeSoft, borderColor: 'transparent' };
      default:
        return { backgroundColor: c.surface, borderColor: c.border };
    }
  })();
  const content = [styles.card, padded && styles.cardPadded, toneStyle, style];
  if (!onPress) return <View style={content}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: c.border }}
      style={({ pressed }) => [content, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  const c = useColors();
  return (
    <View style={styles.sectionHeader}>
      <Text variant="overline" tone="muted">
        {title}
      </Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={12} accessibilityRole="button">
          <Text variant="label" color={c.primary}>
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: inset }} />;
}

export function Row({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

/** Round tinted icon used for categories and locations. */
export function IconBadge({ icon, color, size = 40, soft }: { icon: string; color: string; size?: number; soft?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: soft === false ? color : color + '22',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Icon name={icon} size={size * 0.52} color={soft === false ? '#fff' : color} />
    </View>
  );
}

export function ListItem({
  icon,
  iconColor,
  title,
  subtitle,
  right,
  onPress,
  chevron,
}: {
  icon?: string;
  iconColor?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const c = useColors();
  const body = (
    <>
      {icon && <IconBadge icon={icon} color={iconColor ?? c.textMuted} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <Text variant="bodyStrong" numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        {typeof subtitle === 'string' ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {right}
      {chevron && <Icon name="chevron_right" size={20} color={c.textFaint} />}
    </>
  );
  if (!onPress) return <View style={styles.listItem}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: c.border }}
      style={({ pressed }) => [styles.listItem, pressed && { backgroundColor: c.surfaceAlt }]}
      accessibilityRole="button">
      {body}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Buttons & chips

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'business';

function buttonColors(kind: ButtonKind, c: Colors) {
  switch (kind) {
    case 'primary':
      return { bg: c.primary, fg: c.onPrimary, border: c.primary };
    case 'business':
      return { bg: c.business, fg: '#FFFFFF', border: c.business };
    case 'danger':
      return { bg: c.negativeSoft, fg: c.negative, border: 'transparent' };
    case 'ghost':
      return { bg: 'transparent', fg: c.primary, border: 'transparent' };
    default:
      return { bg: c.surface, fg: c.text, border: c.border };
  }
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  loading,
  style,
  compact,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const c = useColors();
  const col = buttonColors(kind, c);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      android_ripple={{ color: c.border }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: col.bg, borderColor: col.border },
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={col.fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={compact ? 18 : 20} color={col.fg} />}
          <Text variant={compact ? 'label' : 'bodyStrong'} color={col.fg}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color,
  size = 24,
}: {
  icon: string;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: c.border, borderless: true, radius: 22 }}
      style={styles.iconButton}>
      <Icon name={icon} size={size} color={color ?? c.text} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  color,
  onLongPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: PressableProps['onPress'];
  onLongPress?: () => void;
  icon?: string;
  color?: string;
}) {
  const c = useColors();
  const accent = color ?? c.primary;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? accent + '1F' : c.surface,
          borderColor: selected ? accent : c.border,
        },
        pressed && { opacity: 0.75 },
      ]}>
      {icon && <Icon name={icon} size={16} color={selected ? accent : c.textMuted} />}
      <Text variant="label" color={selected ? accent : c.text} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tint,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  tint?: string;
}) {
  const c = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surfaceAlt }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: c.surface, elevation: 1 }]}>
            <Text variant="label" color={active ? (tint ?? c.text) : c.textMuted} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Feedback

export function Banner({
  tone = 'warning',
  icon,
  title,
  children,
}: {
  tone?: 'warning' | 'danger' | 'info' | 'estimate';
  icon?: string;
  title?: string;
  children?: ReactNode;
}) {
  const c = useColors();
  const map = {
    warning: { bg: c.warningSoft, fg: c.warning, icon: 'warning' },
    danger: { bg: c.negativeSoft, fg: c.negative, icon: 'error' },
    info: { bg: c.surfaceAlt, fg: c.textMuted, icon: 'info' },
    estimate: { bg: c.estimateSoft, fg: c.estimate, icon: 'insights' },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: map.bg }]}>
      <Icon name={icon ?? map.icon} size={20} color={map.fg} />
      <View style={{ flex: 1, gap: 2 }}>
        {title && (
          <Text variant="bodyStrong" color={map.fg}>
            {title}
          </Text>
        )}
        {typeof children === 'string' ? (
          <Text variant="label" color={tone === 'info' ? c.textMuted : c.text}>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: string;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <IconBadge icon={icon} color={c.primary} size={56} />
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message && (
        <Text tone="muted" style={{ textAlign: 'center' }}>
          {message}
        </Text>
      )}
      {action && <Button label={action.label} onPress={action.onPress} style={{ marginTop: space.sm }} />}
    </View>
  );
}

export function Loading() {
  const c = useColors();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={c.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardPadded: { padding: space.lg },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.xl,
    marginBottom: space.sm,
    paddingHorizontal: space.xs,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 60,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonCompact: { minHeight: 40, paddingHorizontal: space.lg },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36, borderRadius: radius.sm },
  banner: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, alignItems: 'flex-start' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
});
