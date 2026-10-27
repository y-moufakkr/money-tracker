import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { openTransactions } from '@/lib/drill';
import type { Insight } from '@/services/insights';
import { Icon } from '@/ui/icon';
import { Card, Divider, IconBadge, Row, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

function InsightRow({ insight }: { insight: Insight }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const tint = { info: c.primary, warning: c.warning, danger: c.negative, positive: c.positive }[insight.tone];
  const target = insight.drill ? 'Show transactions' : insight.href ? 'Open' : null;
  return (
    <View style={{ padding: space.md, gap: space.sm }}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityHint="Shows how this was calculated">
        <Row style={{ alignItems: 'flex-start' }} gap={space.md}>
          <IconBadge icon={insight.icon} color={tint} size={36} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{insight.title}</Text>
            <Row gap={2}>
              <Text variant="caption" tone="muted">
                {open ? 'Hide calculation' : 'How is this calculated?'}
              </Text>
              <Icon name={open ? 'expand_less' : 'expand_more'} size={16} color={c.textMuted} />
            </Row>
          </View>
        </Row>
      </Pressable>
      {open && (
        <View style={{ marginLeft: 36 + space.md, gap: space.sm }}>
          <Text variant="label" tone="muted">
            {insight.calculation}
          </Text>
          {target && (
            <Text
              variant="label"
              color={c.primary}
              accessibilityRole="link"
              onPress={() =>
                insight.drill ? openTransactions(insight.drill, insight.title) : router.push(insight.href as Href)
              }>
              {target} →
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** Rule-based insights, each with its calculation one tap away. */
export function InsightList({ insights, limit }: { insights: Insight[]; limit?: number }) {
  const shown = limit ? insights.slice(0, limit) : insights;
  if (shown.length === 0) return null;
  return (
    <Card padded={false}>
      {shown.map((i, idx) => (
        <View key={i.id}>
          {idx > 0 && <Divider inset={space.md} />}
          <InsightRow insight={i} />
        </View>
      ))}
    </Card>
  );
}
