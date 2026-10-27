import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { BASE_CURRENCY, minorToInput, parseAmount, SUPPORTED_CURRENCIES } from '@/domain/money';
import { ACCOUNT_KINDS, type Account, type AccountKind, type Ownership } from '@/domain/types';
import { useCompanies, useLedgerMutation } from '@/hooks/data';
import { closeScreen } from '@/lib/navigation';
import { createAccount, updateAccount, type AccountInput } from '@/services/accounts';
import { ChipGroup, DateField, Field, TextField } from '@/ui/fields';
import { FormScreen } from '@/ui/layout';
import { Banner, Button, Chip, Segmented, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const NAME_HINTS: Record<AccountKind, string> = {
  bank: 'e.g. CIH personal account',
  cash: 'e.g. Wallet, Cash at home',
  savings: 'e.g. Savings account',
  prepaid: 'e.g. Prepaid card',
  ewallet: 'e.g. Mobile wallet',
  credit_card: 'e.g. Visa credit card',
  other: 'e.g. Money kept with family',
};

export function AccountForm({ existing, hasHistory }: { existing?: Account; hasHistory?: boolean }) {
  const c = useColors();
  const companies = useCompanies().data ?? [];
  const [ownership, setOwnership] = useState<Ownership>(existing?.ownership ?? 'personal');
  const [kind, setKind] = useState<AccountKind>(existing?.kind ?? 'bank');
  const [name, setName] = useState(existing?.name ?? '');
  const [institution, setInstitution] = useState(existing?.institution ?? '');
  const [currency, setCurrency] = useState(existing?.currency ?? BASE_CURRENCY);
  const [showCurrencies, setShowCurrencies] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(existing?.companyId ?? null);
  const [companyName, setCompanyName] = useState('');
  const [opening, setOpening] = useState(
    existing ? minorToInput(Math.abs(existing.openingBalanceMinor), existing.currency) : '',
  );
  const [openingNegative, setOpeningNegative] = useState(
    existing ? existing.openingBalanceMinor < 0 && existing.kind !== 'credit_card' : false,
  );
  const [openingDate, setOpeningDate] = useState(existing?.openingDate ?? todayISO());
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const effectiveCompany = ownership === 'business' ? (companyId ?? companies[0]?.id ?? null) : null;
  const isCredit = kind === 'credit_card';
  const openingMinor = opening.trim() === '' ? 0 : parseAmount(opening, currency);

  const save = useLedgerMutation(async (db, input: AccountInput) =>
    existing ? (await updateAccount(db, existing.id, input), existing.id) : createAccount(db, input),
  );

  const submit = () => {
    if (openingMinor === null) {
      Alert.alert('Check the amount', 'The opening balance is not a valid amount.');
      return;
    }
    const signed = isCredit || openingNegative ? -openingMinor : openingMinor;
    save.mutate(
      {
        name,
        kind,
        ownership,
        companyId: effectiveCompany,
        newCompanyName: effectiveCompany ? null : companyName,
        currency,
        openingBalanceMinor: signed,
        openingDate,
        institution,
        notes,
      },
      {
        onSuccess: (id) => {
          if (existing) closeScreen();
          else router.replace(`/accounts/${id}`);
        },
        onError: (e) => Alert.alert('Could not save', e.message),
      },
    );
  };

  return (
    <FormScreen
      footer={<Button label={existing ? 'Save changes' : 'Add location'} onPress={submit} loading={save.isPending} style={{ flex: 1 }} />}>
      <Field label="Whose money is this?">
        <Segmented
          options={[
            { value: 'personal', label: 'Mine (personal)' },
            { value: 'business', label: 'Company (SARL)' },
          ]}
          value={ownership}
          onChange={setOwnership}
          tint={ownership === 'business' ? c.business : c.primary}
        />
      </Field>

      {ownership === 'business' && (
        <Field label="Company" hint="Company money is tracked separately and never added to your personal total.">
          {companies.length > 0 ? (
            <ChipGroup>
              {companies.map((co) => (
                <Chip
                  key={co.id}
                  label={co.name}
                  icon="domain"
                  color={c.business}
                  selected={effectiveCompany === co.id}
                  onPress={() => setCompanyId(co.id)}
                />
              ))}
            </ChipGroup>
          ) : (
            <TextField placeholder="Company name, e.g. My Company SARL" value={companyName} onChangeText={setCompanyName} />
          )}
        </Field>
      )}

      <Field label="Type">
        <ChipGroup>
          {ACCOUNT_KINDS.map((k) => (
            <Chip
              key={k.kind}
              label={k.label}
              icon={k.icon}
              selected={kind === k.kind}
              color={ownership === 'business' ? c.business : undefined}
              onPress={() => setKind(k.kind)}
            />
          ))}
        </ChipGroup>
        <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
          {ACCOUNT_KINDS.find((k) => k.kind === kind)?.hint}
          {kind === 'bank' ? '. Debit cards are not separate money — add them to this account after saving.' : ''}
        </Text>
      </Field>

      <TextField label="Name" placeholder={NAME_HINTS[kind]} value={name} onChangeText={setName} autoCapitalize="words" />

      {(kind === 'bank' || kind === 'savings' || kind === 'credit_card' || kind === 'prepaid') && (
        <TextField
          label="Bank or provider (optional)"
          placeholder="e.g. CIH, Attijariwafa, BMCE, CFG"
          value={institution}
          onChangeText={setInstitution}
        />
      )}

      <Field label="Currency">
        {hasHistory ? (
          <Text tone="muted">{currency} — locked because transactions exist.</Text>
        ) : (
          <ChipGroup>
            {(showCurrencies ? SUPPORTED_CURRENCIES : [BASE_CURRENCY, ...(currency !== BASE_CURRENCY ? [currency] : [])]).map((cur) => (
              <Chip key={cur} label={cur} selected={currency === cur} onPress={() => setCurrency(cur)} />
            ))}
            {!showCurrencies && <Chip label="Other…" onPress={() => setShowCurrencies(true)} />}
          </ChipGroup>
        )}
      </Field>

      <TextField
        label={isCredit ? 'Amount currently owed' : 'Opening balance'}
        hint={
          isCredit
            ? 'What you owe on this card on the opening date. 0 if fully paid.'
            : 'How much is in this location on the opening date. Later activity is added on top.'
        }
        placeholder="0"
        keyboardType="decimal-pad"
        value={opening}
        onChangeText={setOpening}
        error={openingMinor === null ? 'Not a valid amount' : null}
        trailing={<Text tone="muted">{currency}</Text>}
      />
      {!isCredit && (kind === 'bank' || kind === 'other') && (
        <View style={{ marginTop: -space.sm, marginBottom: space.lg }}>
          <Chip
            label="This account is overdrawn (negative)"
            selected={openingNegative}
            color={c.negative}
            onPress={() => setOpeningNegative((v) => !v)}
          />
        </View>
      )}

      <DateField label="Opening balance date" value={openingDate} onChange={setOpeningDate} />

      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />

      {existing && hasHistory && (
        <Banner tone="info">
          Changing the opening balance shifts every later balance by the same amount. Use “Check balance” instead if you
          only want to correct today’s balance with an auditable adjustment.
        </Banner>
      )}
    </FormScreen>
  );
}
