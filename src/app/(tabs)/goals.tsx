import { router } from 'expo-router';
import { View } from 'react-native';

import { AccountRow } from '@/components/account-row';
import { formatMoney } from '@/domain/money';
import { useMoneySummary } from '@/hooks/data';
import { TabScreen } from '@/ui/layout';
import { Amount, Card, Divider, Loading, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function GoalsScreen() {
  const c = useColors();
  const { data } = useMoneySummary();
  const savings = data?.personal.accounts.filter((a) => a.kind === 'savings') ?? [];

  return (
    <TabScreen title="Goals" subtitle="Savings">
      {!data ? (
        <Loading />
      ) : (
        <>
          <Card tone="primary" style={{ gap: 4 }}>
            <Text variant="label" color={c.primary}>
              Savings accounts
            </Text>
            <Amount minor={data.personal.savings} variant="display" />
            <Text variant="caption" tone="muted">
              Of your {formatMoney(data.personal.liquid)} personal money. Nothing is reserved yet.
            </Text>
          </Card>

          {savings.length > 0 && (
            <>
              <SectionHeader title="Where savings are kept" />
              <Card padded={false}>
                {savings.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 && <Divider inset={68} />}
                    <AccountRow account={a} baseMinor={a.baseMinor} />
                  </View>
                ))}
              </Card>
            </>
          )}

          <Card tone="estimate" style={{ marginTop: space.xl, gap: space.sm }}>
            <Text variant="bodyStrong" color={c.estimate}>
              Savings goals arrive in Phase 2
            </Text>
            <Text variant="label" tone="muted">
              You will create goals such as an emergency fund or maternity fund and reserve part of a real account for each one — e.g. 10,000 DH
              of your savings account for emergencies and 5,000 DH for maternity.
            </Text>
            <Text variant="label" tone="muted">
              Reserving never moves or duplicates money: the account still holds 15,000 DH, and My Money will show it split into reserved
              and unallocated. Over-allocation will need explicit confirmation.
            </Text>
          </Card>

          {savings.length === 0 && (
            <Text variant="label" color={c.primary} style={{ marginTop: space.lg, textAlign: 'center' }} onPress={() => router.push('/accounts/new')}>
              Add a savings account
            </Text>
          )}
        </>
      )}
    </TabScreen>
  );
}
