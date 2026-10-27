import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { formatMoney } from '@/domain/money';
import { openTransactions } from '@/lib/drill';
import type { EstimateStep } from '@/services/company';
import type { CompanyCheck } from '@/services/distributions';
import { PAYOUT_LABEL } from '@/services/distributions';
import { Icon } from '@/ui/icon';
import { Amount, Card, Divider, IconBadge, Row, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** One labelled company figure. Each figure on the dashboard is its own row; none is a sum of different kinds. */
export function FigureRow({
  label,
  minor,
  hint,
  tint,
  strong,
  sign,
  onPress,
  missing,
}: {
  label: string;
  minor: number | null;
  hint?: string;
  tint?: string;
  strong?: boolean;
  sign?: 'always';
  onPress?: () => void;
  /** Shown instead of an amount when the figure cannot be computed. */
  missing?: string;
}) {
  const c = useColors();
  const body = (
    <Row style={{ alignItems: 'flex-start', paddingVertical: space.sm }} gap={space.md}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant={strong ? 'bodyStrong' : 'label'}>{label}</Text>
        {hint && (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        )}
      </View>
      {minor === null ? (
        <Text variant="label" tone="faint">
          {missing ?? '—'}
        </Text>
      ) : (
        <Amount minor={minor} variant={strong ? 'heading' : 'bodyStrong'} color={tint} sign={sign} />
      )}
      {onPress && <Icon name="chevron_right" size={18} color={c.textFaint} />}
    </Row>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {body}
    </Pressable>
  );
}

const SOURCE_LABEL: Record<EstimateStep['source'], string> = { recorded: 'Recorded', entered: 'Entered by you', computed: 'Calculated' };

/** Tax-estimate steps; each one opens its calculation (and its transactions when it has some). */
export function EstimateSteps({ steps }: { steps: EstimateStep[] }) {
  return (
    <Card padded={false}>
      {steps.map((s, i) => (
        <View key={s.key}>
          {i > 0 && <Divider inset={space.lg} />}
          <StepRow step={s} />
        </View>
      ))}
    </Card>
  );
}

function StepRow({ step }: { step: EstimateStep }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const tint = step.amountMinor !== null && step.amountMinor < 0 ? c.negative : undefined;
  return (
    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs, backgroundColor: step.result ? c.surfaceAlt : undefined }}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityHint="Shows how this figure was obtained">
        <Row gap={space.md}>
          <View style={{ flex: 1 }}>
            <Text variant={step.result ? 'bodyStrong' : 'label'}>{step.label}</Text>
            <Row gap={2}>
              <Text variant="caption" tone="muted">
                {SOURCE_LABEL[step.source]}
              </Text>
              <Icon name={open ? 'expand_less' : 'expand_more'} size={14} color={c.textMuted} />
            </Row>
          </View>
          {step.amountMinor === null ? (
            <Text variant="label" color={c.warning}>
              Missing
            </Text>
          ) : (
            <Amount minor={step.amountMinor} variant={step.result ? 'heading' : 'bodyStrong'} color={tint} />
          )}
        </Row>
      </Pressable>
      {open && (
        <View style={{ gap: space.xs }}>
          <Text variant="caption" tone="muted">
            {step.calculation}
          </Text>
          {step.drill && (
            <Text variant="caption" color={c.primary} accessibilityRole="link" onPress={() => openTransactions(step.drill!, step.label)}>
              Show transactions →
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** Warnings and notes about the company's records, each with a way to act on it. */
export function CheckList({ checks, limit }: { checks: CompanyCheck[]; limit?: number }) {
  const shown = limit ? checks.slice(0, limit) : checks;
  if (shown.length === 0) return null;
  return (
    <Card padded={false}>
      {shown.map((ch, i) => (
        <View key={ch.id}>
          {i > 0 && <Divider inset={space.lg + 36 + space.md} />}
          <CheckRow check={ch} />
        </View>
      ))}
    </Card>
  );
}

function CheckRow({ check }: { check: CompanyCheck }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const tint = { info: c.business, warning: c.warning, danger: c.negative }[check.tone];
  const icon = { info: 'info', warning: 'warning', danger: 'error' }[check.tone];
  const act = check.drill
    ? () => openTransactions(check.drill!, check.title)
    : check.href
      ? () => router.push(check.href as Href)
      : null;
  return (
    <View style={{ padding: space.md, gap: space.sm }}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityHint="Shows details">
        <Row style={{ alignItems: 'flex-start' }} gap={space.md}>
          <IconBadge icon={icon} color={tint} size={36} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{check.title}</Text>
            <Row gap={2}>
              <Text variant="caption" tone="muted">
                {open ? 'Hide details' : 'Details'}
              </Text>
              <Icon name={open ? 'expand_less' : 'expand_more'} size={16} color={c.textMuted} />
            </Row>
          </View>
        </Row>
      </Pressable>
      {open && (
        <View style={{ marginLeft: 36 + space.md, gap: space.sm }}>
          <Text variant="label" tone="muted">
            {check.detail}
          </Text>
          {act && (
            <Text variant="label" color={c.primary} accessibilityRole="link" onPress={act}>
              {check.drill ? 'Show transactions' : 'Open'} →
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** The simulator / payout result, always with the exact "not yet personal money" label. */
export function PayoutResult({
  netMinor,
  grossMinor,
  withholdingMinor,
  children,
}: {
  netMinor: number;
  grossMinor: number;
  withholdingMinor: number;
  children?: ReactNode;
}) {
  const c = useColors();
  return (
    <Card tone="estimate" style={{ gap: space.sm }}>
      <Row gap={space.sm}>
        <Icon name="insights" size={18} color={c.estimate} />
        <Text variant="label" color={c.estimate} style={{ flex: 1 }}>
          {PAYOUT_LABEL}
        </Text>
      </Row>
      <Amount minor={netMinor} variant="display" color={c.estimate} />
      <View style={{ gap: 2 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label" tone="muted">
            Your gross share
          </Text>
          <Amount minor={grossMinor} variant="label" />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label" tone="muted">
            − Withholding (estimated)
          </Text>
          <Amount minor={-withholdingMinor} variant="label" />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label">Estimated net</Text>
          <Amount minor={netMinor} variant="label" />
        </Row>
      </View>
      {children}
    </Card>
  );
}

/** Small "Estimate" pill used next to figures that are not real money. */
export function EstimatePill({ label = 'Estimate' }: { label?: string }) {
  const c = useColors();
  return (
    <View style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: c.estimate, borderStyle: 'dashed', paddingHorizontal: 8, paddingVertical: 1 }}>
      <Text variant="caption" color={c.estimate}>
        {label}
      </Text>
    </View>
  );
}

export const money = (v: number | null) => (v === null ? '—' : formatMoney(v));
