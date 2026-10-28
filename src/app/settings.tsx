import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { AccountRow } from '@/components/account-row';
import { BackupSection } from '@/components/backup';
import { DATABASE_NAME } from '@/db/expo';
import { SCHEMA_VERSION } from '@/db/migrations';
import { todayISO } from '@/domain/dates';
import { bpToInput, formatRate, parsePercentBp, parseRateMicros, SUPPORTED_CURRENCIES } from '@/domain/money';
import { useAccountBalances, useCompanies, useLedgerMutation, useRates, useSetting } from '@/hooks/data';
import { updateCompany, type CompanyInput } from '@/services/accounts';
import { notify } from '@/lib/confirm';
import { setRate } from '@/services/fx';
import { SETTING, setSetting } from '@/services/queries';
import { ChipGroup, Field, TextField, Toggle } from '@/ui/fields';
import { Button, Card, Chip, Divider, ListItem, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';
import type { Company, PayoutMode, TvaMode } from '@/domain/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function CompanyEditor({ company }: { company: Company }) {
  const c = useColors();
  const [name, setName] = useState(company.name);
  const [pct, setPct] = useState(bpToInput(company.ownershipBp));
  const [month, setMonth] = useState(company.fiscalYearStartMonth);
  const [tvaMode, setTvaMode] = useState<TvaMode>(company.tvaMode);
  const [payoutMode, setPayoutMode] = useState<PayoutMode>(company.payoutMode);
  const [share, setShare] = useState(company.simplePayoutBp === null ? '' : bpToInput(company.simplePayoutBp));
  // The id travels in the input so the mutation never reads props during render (React Compiler).
  const save = useLedgerMutation((db, v: { id: string; input: CompanyInput }) => updateCompany(db, v.id, v.input));
  const bp = parsePercentBp(pct);
  const shareBp = share.trim() ? parsePercentBp(share) : null;
  const shareInvalid = payoutMode === 'simple' && shareBp === null;
  const dirty =
    name !== company.name ||
    bp !== company.ownershipBp ||
    month !== company.fiscalYearStartMonth ||
    tvaMode !== company.tvaMode ||
    payoutMode !== company.payoutMode ||
    (payoutMode === 'simple' && shareBp !== company.simplePayoutBp);
  const companyId = company.id;
  return (
    <Card style={{ marginBottom: space.sm }}>
      <TextField label="Company name" value={name} onChangeText={setName} />
      <TextField
        label="Your ownership"
        hint="Used to estimate your share of distributions. It does not entitle you to withdraw company cash."
        value={pct}
        onChangeText={setPct}
        keyboardType="decimal-pad"
        error={bp === null ? 'Between 0 and 100' : null}
        trailing={<Text tone="muted">%</Text>}
      />
      <Field label="Fiscal year starts in" hint="Used when creating fiscal years.">
        <ChipGroup>
          {MONTHS.map((m, i) => (
            <Chip key={m} label={m} selected={month === i + 1} onPress={() => setMonth(i + 1)} color={c.business} />
          ))}
        </ChipGroup>
      </Field>
      <Field label="TVA in recorded amounts" hint="Bank movements usually include TVA. The tax estimate then removes the TVA you enter per year.">
        <ChipGroup>
          <Chip label="Included (TTC)" selected={tvaMode === 'ttc'} onPress={() => setTvaMode('ttc')} color={c.business} />
          <Chip label="None (HT / not liable)" selected={tvaMode === 'ht'} onPress={() => setTvaMode('ht')} color={c.business} />
        </ChipGroup>
      </Field>
      <Field
        label="Estimate of your payout"
        hint="Detailed uses fiscal years, tax rates and obligations. Simple is for when you do not have the accountant figures: you enter which part of the company money is really yours, after tax and everything else.">
        <ChipGroup>
          <Chip label="Detailed (accounting)" selected={payoutMode === 'detailed'} onPress={() => setPayoutMode('detailed')} color={c.business} />
          <Chip label="Simple (a % of company money)" selected={payoutMode === 'simple'} onPress={() => setPayoutMode('simple')} color={c.business} />
        </ChipGroup>
      </Field>
      {payoutMode === 'simple' && (
        <TextField
          label="Your net share of current company money"
          hint="e.g. 28: the potential payout is 28% of what the company accounts hold now. Still an estimate, never added to your personal money."
          value={share}
          onChangeText={setShare}
          keyboardType="decimal-pad"
          error={shareInvalid ? 'Between 0 and 100' : null}
          trailing={<Text tone="muted">%</Text>}
        />
      )}
      <Row>
        <Button compact kind="ghost" label="Open dashboard" onPress={() => router.push(`/company/${companyId}`)} />
        {dirty && (
          <Button
            compact
            label="Save company"
            disabled={bp === null || shareInvalid}
            loading={save.isPending}
            onPress={() =>
              bp !== null &&
              save.mutate(
                {
                  id: companyId,
                  input: { name, ownershipBp: bp, fiscalYearStartMonth: month, tvaMode, payoutMode, ...(payoutMode === 'simple' ? { simplePayoutBp: shareBp } : {}) },
                },
                { onError: (e) => notify('Could not save', e.message) },
              )
            }
          />
        )}
      </Row>
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
  const ocrExport = useSetting(SETTING.receiptOcrExport).data === '1';
  const setOcrExport = useLedgerMutation((db, on: boolean) => setSetting(db, SETTING.receiptOcrExport, on ? '1' : '0'));
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
        <Divider inset={68} />
        <ListItem icon="event_repeat" iconColor={c.primary} title="Bills & expected payments" subtitle="Recurring bills, expected income" chevron onPress={() => router.push('/bills')} />
        <Divider inset={68} />
        <ListItem icon="handshake" iconColor={c.primary} title="Debts & money owed" subtitle="Loans, money borrowed or lent" chevron onPress={() => router.push('/debts')} />
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

      <SectionHeader title="Backup & export" />
      <BackupSection />

      <SectionHeader title="Developer" />
      <Card style={{ marginBottom: space.sm }}>
        <Toggle
          label="Share OCR data from scans"
          description="Scanned receipts show “Share OCR data”: the text, positions and confidence that were read, to add the receipt to the reader's tests. Nothing is stored or sent unless you share it."
          value={ocrExport}
          onChange={(on) => setOcrExport.mutate(on)}
        />
      </Card>

      <SectionHeader title="About" />
      <Card style={{ gap: 4 }}>
        <Text variant="label" tone="muted">Database: {DATABASE_NAME} · schema v{SCHEMA_VERSION}</Text>
        <Text variant="label" tone="muted">Timezone: Africa/Casablanca · Base currency: MAD</Text>
        <Text variant="label" tone="muted">All data is stored offline on this device. Google Drive holds backup copies only.</Text>
      </Card>
    </ScrollView>
  );
}
