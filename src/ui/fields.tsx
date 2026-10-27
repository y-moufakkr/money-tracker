import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Switch, TextInput, View, type TextInputProps } from 'react-native';

import { addDays, formatDateLabel, isoToLocalDate, localDateToISO, todayISO } from '@/domain/dates';
import { currencyInfo } from '@/domain/money';
import { Chip, Row, Text } from './primitives';
import { radius, space, useColors } from './theme';

export function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 6, gap: 2 }}>
      <Text variant="label" tone="muted">
        {children}
      </Text>
      {hint && (
        <Text variant="caption" tone="faint">
          {hint}
        </Text>
      )}
    </View>
  );
}

export function Field({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      {label && <FieldLabel hint={hint}>{label}</FieldLabel>}
      {children}
    </View>
  );
}

export function TextField({
  label,
  hint,
  error,
  style,
  leading,
  trailing,
  ...props
}: TextInputProps & { label?: string; hint?: string; error?: string | null; leading?: ReactNode; trailing?: ReactNode }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <View
        style={[
          styles.input,
          {
            backgroundColor: c.surface,
            borderColor: error ? c.negative : focused ? c.primary : c.border,
          },
        ]}>
        {leading}
        <TextInput
          placeholderTextColor={c.textFaint}
          selectionColor={c.primary}
          cursorColor={c.primary}
          {...props}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[styles.inputText, { color: c.text }, style]}
        />
        {trailing}
      </View>
      {error ? (
        <Text variant="caption" color={c.negative} style={{ marginTop: 4 }}>
          {error}
        </Text>
      ) : null}
    </Field>
  );
}

/** Large amount entry used at the top of entry screens. */
export function AmountInput({
  value,
  onChangeText,
  currency,
  autoFocus,
  tint,
  invalid,
  accessibilityLabel = 'Amount',
}: {
  value: string;
  onChangeText: (s: string) => void;
  currency: string;
  autoFocus?: boolean;
  tint?: string;
  invalid?: boolean;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const { symbol } = currencyInfo(currency);
  return (
    <View style={styles.amountWrap}>
      <TextInput
        value={value}
        onChangeText={(t) => onChangeText(t.replace(/[^0-9.,]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={c.textFaint}
        autoFocus={autoFocus}
        selectionColor={tint ?? c.primary}
        cursorColor={tint ?? c.primary}
        accessibilityLabel={accessibilityLabel}
        style={[styles.amountText, { color: invalid ? c.negative : (tint ?? c.text) }]}
        maxLength={14}
      />
      <Text variant="title" tone="muted">
        {symbol}
      </Text>
    </View>
  );
}

/** Date chips (Today / Yesterday) plus a native date picker. Never allows future dates. */
export function DateField({
  value,
  onChange,
  minimumDate,
  label = 'Date',
}: {
  value: string;
  onChange: (iso: string) => void;
  minimumDate?: string;
  label?: string;
}) {
  const today = todayISO();
  const yesterday = addDays(today, -1);
  const [iosOpen, setIosOpen] = useState(false);
  const custom = value !== today && value !== yesterday;

  const open = () => {
    const opts = {
      value: isoToLocalDate(value),
      mode: 'date' as const,
      maximumDate: isoToLocalDate(today),
      minimumDate: minimumDate ? isoToLocalDate(minimumDate) : undefined,
    };
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        ...opts,
        onChange: (event, date) => {
          if (event.type === 'set' && date) onChange(localDateToISO(date));
        },
      });
    } else {
      setIosOpen((v) => !v);
    }
  };

  return (
    <Field label={label}>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label="Today" selected={value === today} onPress={() => onChange(today)} />
        <Chip label="Yesterday" selected={value === yesterday} onPress={() => onChange(yesterday)} />
        <Chip
          label={custom ? formatDateLabel(value) : 'Pick date'}
          icon="calendar_today"
          selected={custom}
          onPress={open}
        />
      </Row>
      {iosOpen && Platform.OS !== 'android' && (
        <DateTimePicker
          value={isoToLocalDate(value)}
          mode="date"
          display="inline"
          maximumDate={isoToLocalDate(today)}
          minimumDate={minimumDate ? isoToLocalDate(minimumDate) : undefined}
          onChange={(_, d) => d && onChange(localDateToISO(d))}
        />
      )}
    </Field>
  );
}

/** Horizontally scrolling row isn't needed for small sets; wraps instead. */
export function ChipGroup({ children }: { children: ReactNode }) {
  return <View style={styles.chipGroup}>{children}</View>;
}

export function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{label}</Text>
        {description && (
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.primary + '88', false: c.border }}
        thumbColor={value ? c.primary : c.surfaceAlt}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 50,
  },
  inputText: { flex: 1, fontSize: 16, paddingVertical: space.md },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
  amountText: {
    fontSize: 48,
    fontWeight: '700',
    minWidth: 60,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    padding: 0,
  },
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
});
