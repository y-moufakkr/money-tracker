import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { formatMoney } from '@/domain/money';
import { Row, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

export type ChartPoint = { label: string; value: number };

const PAD_TOP = 12;
const PAD_BOTTOM = 8;
/** Keeps end markers inside the plot. */
const PAD_X = 6;

/**
 * Single-series line chart with a tappable crosshair. Tapping a point selects
 * it; `onOpen` (if given) adds an action to drill into that point.
 */
export function LineChart({
  points,
  height = 160,
  color,
  format = (v) => formatMoney(v),
  selected,
  onSelect,
  footer,
  zeroBased = true,
}: {
  points: ChartPoint[];
  /** Include 0 on the axis (balances). Prices use their own range so changes stay visible. */
  zeroBased?: boolean;
  height?: number;
  color?: string;
  format?: (v: number) => string;
  /** Controlled selection; defaults to the last point. */
  selected?: number;
  onSelect?: (index: number) => void;
  /** Rendered under the selected value, e.g. a drill-down link. */
  footer?: React.ReactNode;
}) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const [own, setOwn] = useState<number | null>(null);
  const stroke = color ?? c.primary;
  const index = selected ?? own ?? points.length - 1;
  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  let min = Math.min(...values, ...(zeroBased ? [0] : []));
  let max = Math.max(...values, ...(zeroBased ? [0] : []));
  if (min === max) {
    min -= Math.max(1, Math.abs(min) * 0.1);
    max += Math.max(1, Math.abs(max) * 0.1);
  } else if (!zeroBased) {
    const pad = (max - min) * 0.15;
    min -= pad;
    max += pad;
  }
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const step = points.length > 1 ? (width - 2 * PAD_X) / (points.length - 1) : 0;
  const x = (i: number) => (points.length > 1 ? PAD_X + i * step : width / 2);
  const y = (v: number) => PAD_TOP + ((max - v) / (max - min)) * plotH;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(min)} L${x(0).toFixed(1)},${y(min)} Z`;
  const sel = points[Math.min(index, points.length - 1)];
  const pick = (i: number) => (onSelect ? onSelect(i) : setOwn(i));

  return (
    <View style={{ gap: space.sm }}>
      <View>
        <Text variant="caption" tone="muted">
          {sel.label}
        </Text>
        <Text variant="heading" style={{ fontVariant: ['tabular-nums'] }}>
          {format(sel.value)}
        </Text>
        {footer}
      </View>
      <View
        style={{ height }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`Chart: ${points.map((p) => `${p.label} ${format(p.value)}`).join(', ')}`}>
        {width > 0 && (
          <>
            <Svg width={width} height={height}>
              {min < 0 && max > 0 && (
                <Line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={c.border} strokeWidth={1} strokeDasharray="4 4" />
              )}
              <Line x1={0} x2={width} y1={height - PAD_BOTTOM} y2={height - PAD_BOTTOM} stroke={c.border} strokeWidth={1} />
              {zeroBased && <Path d={area} fill={stroke} fillOpacity={0.08} />}
              <Path d={line} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              <Line x1={x(index)} x2={x(index)} y1={PAD_TOP} y2={height - PAD_BOTTOM} stroke={c.textFaint} strokeWidth={1} />
              {!zeroBased &&
                points.map((p, i) => <Circle key={i} cx={x(i)} cy={y(p.value)} r={4} fill={stroke} stroke={c.surface} strokeWidth={2} />)}
              <Circle cx={x(index)} cy={y(sel.value)} r={5} fill={stroke} stroke={c.surface} strokeWidth={2} />
            </Svg>
            {/* One full-height hit target per point, wider than the mark. */}
            <View style={{ position: 'absolute', left: PAD_X - step / 2, right: PAD_X - step / 2, top: 0, bottom: 0, flexDirection: 'row' }}>
              {points.map((p, i) => (
                <Pressable
                  key={i}
                  style={{ flex: 1 }}
                  onPress={() => pick(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.label}: ${format(p.value)}`}
                />
              ))}
            </View>
          </>
        )}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="caption" tone="faint">
          {points[0].label}
        </Text>
        <Text variant="caption" tone="faint">
          {points[points.length - 1].label}
        </Text>
      </Row>
    </View>
  );
}

/** Vertical columns (e.g. spend per month). Tapping a column selects it. */
export function ColumnChart({
  points,
  height = 120,
  color,
  format = (v) => formatMoney(v),
  onPress,
}: {
  points: ChartPoint[];
  height?: number;
  color?: string;
  format?: (v: number) => string;
  onPress?: (index: number) => void;
}) {
  const c = useColors();
  const [index, setIndex] = useState(points.length - 1);
  const max = Math.max(...points.map((p) => p.value), 1);
  const sel = points[Math.min(index, points.length - 1)];
  if (!sel) return null;
  return (
    <View style={{ gap: space.sm }}>
      <View>
        <Text variant="caption" tone="muted">
          {sel.label}
        </Text>
        <Text variant="heading" style={{ fontVariant: ['tabular-nums'] }}>
          {format(sel.value)}
        </Text>
      </View>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1, borderColor: c.border }}>
        {points.map((p, i) => (
          <Pressable
            key={i}
            style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}
            onPress={() => {
              setIndex(i);
              onPress?.(i);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${p.label}: ${format(p.value)}`}>
            <View
              style={{
                height: p.value > 0 ? Math.max(2, (p.value / max) * height) : 0,
                backgroundColor: color ?? c.primary,
                opacity: i === index ? 1 : 0.45,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            />
          </Pressable>
        ))}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="caption" tone="faint">
          {points[0].label}
        </Text>
        <Text variant="caption" tone="faint">
          {points[points.length - 1].label}
        </Text>
      </Row>
    </View>
  );
}

/**
 * Budget-style progress bar. The fill turns warning once a threshold is
 * reached and negative past 100 %; the label states it, so colour is never
 * the only signal.
 */
export function Meter({ ratio, thresholds = [], height = 8 }: { ratio: number; thresholds?: number[]; height?: number }) {
  const c = useColors();
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 1));
  const reached = thresholds.some((t) => ratio * 100 >= t);
  const fill = ratio >= 1 ? c.negative : reached ? c.warning : c.primary;
  return (
    <View style={{ height, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(pct > 0 ? 2 : 0, pct * 100)}%`, height: '100%', backgroundColor: fill, borderRadius: radius.pill }} />
      {thresholds
        .filter((t) => t < 100)
        .map((t) => (
          <View key={t} style={{ position: 'absolute', left: `${t}%`, top: 0, bottom: 0, width: 2, backgroundColor: c.surface }} />
        ))}
    </View>
  );
}
