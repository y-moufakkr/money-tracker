import { View } from 'react-native';

import { formatMoney, percentShares } from '@/domain/money';
import { Row, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

export type Slice = { key: string; label: string; minor: number; color: string };

/** Stacked horizontal bar + legend. Negative slices are excluded from the shares. */
export function Breakdown({ slices, currency }: { slices: Slice[]; currency?: string }) {
  const c = useColors();
  const visible = slices.filter((s) => s.minor > 0);
  const shares = percentShares(visible.map((s) => s.minor));
  if (visible.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <View
        style={{ flexDirection: 'row', height: 14, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: c.surfaceAlt, gap: 2 }}
        accessibilityLabel={visible.map((s, i) => `${s.label} ${shares[i]} percent`).join(', ')}>
        {visible.map((s) => (
          <View key={s.key} style={{ flex: s.minor, backgroundColor: s.color }} />
        ))}
      </View>
      <View style={{ gap: space.sm }}>
        {visible.map((s, i) => (
          <Row key={s.key}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color }} />
            <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
              {s.label}
            </Text>
            <Text variant="label" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMoney(s.minor, currency)}
            </Text>
            <Text variant="label" style={{ width: 42, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {shares[i]}%
            </Text>
          </Row>
        ))}
      </View>
    </View>
  );
}

/** A single labelled progress bar, used for category totals. */
export function BarRow({
  label,
  minor,
  max,
  color,
  currency,
  detail,
}: {
  label: string;
  minor: number;
  max: number;
  color: string;
  currency?: string;
  detail?: string;
}) {
  const c = useColors();
  const pct = max > 0 ? Math.max(2, Math.round((minor / max) * 100)) : 0;
  return (
    <View style={{ gap: 6 }}>
      <Row>
        <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
          {label}
        </Text>
        {detail && (
          <Text variant="caption" tone="muted">
            {detail}
          </Text>
        )}
        <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>
          {formatMoney(minor, currency)}
        </Text>
      </Row>
      <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: radius.pill }} />
      </View>
    </View>
  );
}
