import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { formatBytes } from '@/components/backup';
import { PERIOD_LABELS, presetRange, todayISO, type PeriodPreset } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useBackupActions, useExportPreview } from '@/hooks/backup';
import { useAllCategories, useDb } from '@/hooks/data';
import { APP_VERSION } from '@/lib/app-info';
import { notify } from '@/lib/confirm';
import { shareFile } from '@/lib/files';
import { exportFileName, exportJson, toCsv, totalsOf, type ExportEntry, type ExportFilter, type ExportScope } from '@/services/export';
import { ChipGroup, DateButton, Field, Toggle } from '@/ui/fields';
import { Banner, Button, Card, Chip, Divider, Row, Segmented, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

type Period = PeriodPreset | 'all' | 'custom';
const PERIODS: Period[] = ['this_month', 'last_month', 'this_year', 'last_year', 'all', 'custom'];
const ALL_TIME_FROM = '2000-01-01';

function SideTotals({ title, entries, tint }: { title: string; entries: ExportEntry[]; tint: string }) {
  const totals = totalsOf(entries);
  return (
    <View style={{ gap: 2 }}>
      <Text variant="label" color={tint}>
        {title} · {entries.length} {entries.length === 1 ? 'row' : 'rows'}
      </Text>
      {totals.length === 0 ? (
        <Text variant="caption" tone="muted">
          Nothing in this selection.
        </Text>
      ) : (
        totals.map((t) => (
          <Text key={t.currency} variant="caption" tone="muted">
            In {formatMoney(t.incomeMinor + t.transfersInMinor, t.currency)} · out {formatMoney(t.expensesMinor + t.transfersOutMinor, t.currency)}
            {t.adjustmentsMinor !== 0 ? ` · adjustments ${formatMoney(t.adjustmentsMinor, t.currency, { sign: 'always' })}` : ''} · net{' '}
            {formatMoney(t.netChangeMinor, t.currency, { sign: 'always' })}
          </Text>
        ))
      )}
    </View>
  );
}

export default function ExportScreen() {
  const c = useColors();
  const db = useDb();
  const today = todayISO();
  const [period, setPeriod] = useState<Period>('this_year');
  const [custom, setCustom] = useState({ from: presetRange('this_month', today).from, to: today });
  const [scope, setScope] = useState<ExportScope>('all');
  const [allCategories, setAllCategories] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [uncategorised, setUncategorised] = useState(false);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [sharing, setSharing] = useState(false);
  const expense = (useAllCategories('expense').data ?? []).filter((x) => !x.parentId && !x.isArchived);
  const income = (useAllCategories('income').data ?? []).filter((x) => !x.parentId && !x.isArchived);
  const actions = useBackupActions();

  const range = period === 'custom' ? custom : period === 'all' ? { from: ALL_TIME_FROM, to: today } : presetRange(period, today);
  const filter: ExportFilter = {
    ...range,
    scope,
    categoryIds: allCategories ? null : selected,
    includeUncategorised: !allCategories && uncategorised,
  };
  const preview = useExportPreview(filter);
  const entries = preview.data ?? [];
  const personal = entries.filter((e) => e.side === 'personal');
  const companies = [...new Set(entries.filter((e) => e.side === 'company').map((e) => e.companyName ?? ''))];

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const exportNow = async () => {
    setSharing(true);
    try {
      if (format === 'csv') {
        await shareFile(exportFileName(filter, 'csv'), toCsv(entries), 'text/csv');
      } else {
        const json = await exportJson(db, filter, { appVersion: APP_VERSION }, entries);
        await shareFile(exportFileName(filter, 'json'), JSON.stringify(json, null, 2), 'application/json');
      }
    } catch (e) {
      notify('Export failed', (e as Error).message);
    } finally {
      setSharing(false);
    }
  };

  const saveBackupFile = () =>
    actions.snapshot.mutate(undefined, {
      onSuccess: async ({ bytes, manifest }) => {
        try {
          await shareFile(`money-tracker-backup-${manifest.createdAt.slice(0, 10)}.db`, bytes, 'application/vnd.sqlite3');
        } catch (e) {
          notify('Could not share the file', (e as Error).message);
        }
      },
      onError: (e) => notify('Backup file failed', e.message),
    });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
      <SectionHeader title="Transactions as CSV or JSON" />
      <Card>
        <Field label="Period">
          <ChipGroup>
            {PERIODS.map((p) => (
              <Chip
                key={p}
                label={p === 'all' ? 'All time' : p === 'custom' ? 'Custom' : PERIOD_LABELS[p]}
                selected={period === p}
                onPress={() => setPeriod(p)}
              />
            ))}
          </ChipGroup>
          {period === 'custom' && (
            <Row style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
              <DateButton label="From" value={custom.from} maximumDate={custom.to} onChange={(from) => setCustom((r) => ({ ...r, from }))} />
              <DateButton label="To" value={custom.to} minimumDate={custom.from} onChange={(to) => setCustom((r) => ({ ...r, to }))} />
            </Row>
          )}
        </Field>
        <Field label="Money" hint="Every row says whose money it is. Company rows also name the company.">
          <ChipGroup>
            <Chip label="Personal + company" selected={scope === 'all'} onPress={() => setScope('all')} />
            <Chip label="Personal only" selected={scope === 'personal'} onPress={() => setScope('personal')} />
            <Chip label="Company only" selected={scope === 'company'} onPress={() => setScope('company')} color={c.business} />
          </ChipGroup>
        </Field>
        <Toggle
          label="All categories"
          description="Includes transfers and balance adjustments. Turn off to choose categories (subcategories included)."
          value={allCategories}
          onChange={setAllCategories}
        />
        {!allCategories && (
          <View style={{ gap: space.sm, marginTop: space.sm, marginBottom: space.md }}>
            <Text variant="label" tone="muted">
              Spending
            </Text>
            <ChipGroup>
              {expense.map((cat) => (
                <Chip key={cat.id} label={cat.name} selected={selected.includes(cat.id)} onPress={() => toggle(cat.id)} />
              ))}
            </ChipGroup>
            <Text variant="label" tone="muted">
              Income
            </Text>
            <ChipGroup>
              {income.map((cat) => (
                <Chip key={cat.id} label={cat.name} selected={selected.includes(cat.id)} onPress={() => toggle(cat.id)} />
              ))}
              <Chip label="Uncategorised" selected={uncategorised} onPress={() => setUncategorised((v) => !v)} />
            </ChipGroup>
          </View>
        )}
        <Field label="Format">
          <Segmented
            value={format}
            onChange={setFormat}
            options={[
              { value: 'csv', label: 'CSV (spreadsheet)' },
              { value: 'json', label: 'JSON (complete)' },
            ]}
          />
        </Field>
        <Divider />
        <View style={{ gap: space.sm, marginVertical: space.md }}>
          {scope !== 'company' && <SideTotals title="Personal" entries={personal} tint={c.primary} />}
          {scope !== 'personal' &&
            (companies.length === 0 ? (
              <SideTotals title="Company" entries={[]} tint={c.business} />
            ) : (
              companies.map((name) => (
                <SideTotals key={name} title={name} entries={entries.filter((e) => e.side === 'company' && e.companyName === name)} tint={c.business} />
              ))
            ))}
          <Text variant="caption" tone="faint">
            {format === 'csv'
              ? 'One row per effect on a money location; amounts are signed decimals in the location’s currency. A company → personal transfer is two rows, one per side.'
              : 'Adds per-currency totals for each side, and for companies the fiscal-year assumptions with their sources, obligations and distributions.'}{' '}
            Personal and company totals are never added together.
          </Text>
        </View>
        <Button
          label={`Export ${entries.length} rows as ${format.toUpperCase()}`}
          icon="ios_share"
          loading={sharing}
          disabled={preview.isLoading || (format === 'csv' && entries.length === 0)}
          onPress={exportNow}
        />
      </Card>

      <SectionHeader title="Full backup file" />
      <Card style={{ gap: space.sm }}>
        <Text variant="label" tone="muted">
          A complete copy of the database (every table, all history), taken safely while the app runs. Save it anywhere: it can be restored
          from Backups & restore → Restore from a file, and opened with any SQLite tool. It is not encrypted: keep it somewhere private.
        </Text>
        <Button kind="secondary" icon="save" label="Save a full backup file (.db)" loading={actions.snapshot.isPending} onPress={saveBackupFile} />
        {actions.snapshot.data && (
          <Text variant="caption" tone="faint">
            Last file: {formatBytes(actions.snapshot.data.manifest.size)} · SHA-256 {actions.snapshot.data.manifest.sha256.slice(0, 16)}…
          </Text>
        )}
      </Card>
      <View style={{ marginTop: space.md }}>
        <Banner tone="info">Exports are files you share or save yourself. Nothing is uploaded unless you choose a destination.</Banner>
      </View>
    </ScrollView>
  );
}
