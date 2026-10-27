import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { AccountRow } from '@/components/account-row';
import { DATABASE_NAME } from '@/db/expo';
import { SCHEMA_VERSION } from '@/db/migrations';
import { todayISO } from '@/domain/dates';
import { formatRate, parseRateMicros, SUPPORTED_CURRENCIES } from '@/domain/money';
import { useAccountBalances, useCompanies, useLedgerMutation, useRates } from '@/hooks/data';
import { updateCompany } from '@/services/accounts';
import { setRate } from '@/services/fx';
import { ChipGroup, TextField } from '@/ui/fields';
import { Banner, Button, Card, Chip, Divider, ListItem, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';
import type { Company } from '@/domain/types';

function CompanyEditor({ company }: { company: Company }) {
  const [name, setName] = useState(company.name);
  const [pct, setPct] = useState(String(company.ownershipBp / 100));
  const save = useLedgerMutation((db, v: { name: string; bp: number }) => updateCompany(db, company.id, { name: v.name, ownershipBp: v.bp }));
  const bp = Math.round(Number(pct.replace(',', '.')) * 100);
  const valid = Number.isFinite(bp) && bp >= 0 && bp <= 10000;
  const dirty = name !== company.name || bp !== company.ownershipBp;
  return (
    <Card style={{ marginBottom: space.sm }}>
      <TextField label="Company name" value={name} onChangeText={setName} />
      <TextField
        label="Your ownership"
        hint="Used later to estimate your share of distributions. It does not entitle you to withdraw company cash."
        value={pct}
        onChangeText={setPct}
        keyboardType="decimal-pad"
        error={valid ? null : 'Between 0 and 100'}
        trailing={<Text tone="muted">%</Text>}
      />
      {dirty && (
        <Button
          compact
          label="Save company"
          disabled={!valid}
          loading={save.isPending}
          onPress={() => save.mutate({ name, bp }, { onError: (e) => Alert.alert('Could not save', e.message) })}
        />
      )}
    </Card>
  );
}

export default function SettingsScreen() {
  const c = useColors();
  const companies = useCompanies().data ?? [];
  const rates = useRates().data ?? [];
  const archived = (useAccountBalances({ includeArchived: true }).data ?? []).filter((a) => a.isArchived);
  const [currency, setCurrency] = useState('EUR');
  const [rate, setRateText] = useState('');
  const addRate = useLedgerMutation((db, micros: number) => setRate(db, currency, micros, todayISO()));
  const micros = rate.trim() ? parseRateMicros(rate) : null;

  const latest = new Map<string, (typeof rates)[number]>();
  for (const r of rates) if (!latest.has(r.currency)) latest.set(r.currency, r);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
      <SectionHeader title="Organise" />
      <Card padded={false}>
        <ListItem icon="category" iconColor={c.primary} title="Categories" subtitle="Subcategories, essential spending, merge" chevron onPress={() => router.push('/categories')} />
        <Divider inset={68} />
        <ListItem icon="sell" iconColor={c.primary} title="Tags" chevron onPress={() => router.push('/tags')} />
        <Divider inset={68} />
        <ListItem icon="store" iconColor={c.primary} title="Merchants" chevron onPress={() => router.push('/merchants')} />
        <Divider inset={68} />
        <ListItem icon="shopping_basket" iconColor={c.primary} title="Products & prices" chevron onPress={() => router.push('/products')} />
        <Divider inset={68} />
        <ListItem icon="savings" iconColor={c.primary} title="Budgets" chevron onPress={() => router.push('/budgets')} />
      </Card>

      <SectionHeader title="Companies" />
      {companies.length === 0 ? (
        <Card>
          <Text tone="muted">A company is created when you add your first company (SARL) money location.</Text>
          <Button compact kind="ghost" label="Add company account" onPress={() => router.push('/accounts/new')} />
        </Card>
      ) : (
        companies.map((co) => <CompanyEditor key={co.id} company={co} />)
      )}

      <SectionHeader title="Exchange rates" />
      <Card>
        <Text variant="caption" tone="muted" style={{ marginBottom: space.md }}>
          Used only to include foreign-currency locations in MAD totals. Without a rate, those locations are shown but not counted.
        </Text>
        {[...latest.values()].map((r) => (
          <Row key={r.currency} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text>1 {r.currency}</Text>
            <Text>
              {formatRate(r.rateMicros)} DH <Text variant="caption" tone="faint">({r.asOf})</Text>
            </Text>
          </Row>
        ))}
        {latest.size > 0 && <Divider />}
        <View style={{ marginTop: space.md }}>
          <ChipGroup>
            {SUPPORTED_CURRENCIES.filter((x) => x !== 'MAD').map((cur) => (
              <Chip key={cur} label={cur} selected={currency === cur} onPress={() => setCurrency(cur)} />
            ))}
          </ChipGroup>
          <View style={{ height: space.md }} />
          <TextField
            label={`1 ${currency} = ? DH (today)`}
            placeholder="e.g. 10.85"
            keyboardType="decimal-pad"
            value={rate}
            onChangeText={setRateText}
            error={rate.trim() && micros === null ? 'Not a valid rate' : null}
          />
          <Button
            compact
            label="Save rate"
            disabled={micros === null}
            loading={addRate.isPending}
            onPress={() => addRate.mutate(micros!, { onSuccess: () => setRateText(''), onError: (e) => Alert.alert('Could not save', e.message) })}
          />
        </View>
      </Card>

      <SectionHeader title={`Archived locations (${archived.length})`} />
      <Card padded={false}>
        {archived.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Text tone="muted">None.</Text>
          </View>
        ) : (
          archived.map((a, i) => (
            <View key={a.id}>
              {i > 0 && <Divider inset={68} />}
              <AccountRow account={a} />
            </View>
          ))
        )}
      </Card>

      <SectionHeader title="Backup & sync" />
      <Card style={{ gap: space.sm }}>
        <ListItem icon="sync" iconColor={c.textMuted} title="Sync to Google Drive" subtitle="Coming in Phase 4 — private app folder, manual backup & restore" />
        <Banner tone="warning">
          Until then your data lives only on this phone. Uninstalling the app or clearing its storage deletes it.
        </Banner>
      </Card>

      <SectionHeader title="About" />
      <Card style={{ gap: 4 }}>
        <Text variant="label" tone="muted">Database: {DATABASE_NAME} · schema v{SCHEMA_VERSION}</Text>
        <Text variant="label" tone="muted">Timezone: Africa/Casablanca · Base currency: MAD</Text>
        <Text variant="label" tone="muted">All data is stored offline on this device.</Text>
      </Card>
    </ScrollView>
  );
}
