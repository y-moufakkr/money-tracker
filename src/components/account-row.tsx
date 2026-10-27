import { router } from 'expo-router';

import { formatMoney } from '@/domain/money';
import { accountKindIcon, accountKindLabel, type AccountWithBalance } from '@/domain/types';
import { Amount, ListItem } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

export function AccountRow({
  account,
  baseMinor,
  onPress,
}: {
  account: AccountWithBalance;
  /** Balance converted to MAD, shown as a caption for foreign-currency locations. */
  baseMinor?: number | null;
  onPress?: () => void;
}) {
  const c = useColors();
  const tint = account.ownership === 'business' ? c.business : account.kind === 'credit_card' ? c.negative : c.primary;
  const subtitle = [
    account.institution ?? accountKindLabel(account.kind),
    account.currency !== 'MAD' ? (baseMinor == null ? 'no exchange rate' : `≈ ${formatMoney(baseMinor)}`) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListItem
      icon={accountKindIcon(account.kind)}
      iconColor={tint}
      title={account.name}
      subtitle={subtitle}
      right={
        <Amount
          minor={account.balanceMinor}
          currency={account.currency}
          colored={account.kind === 'credit_card' ? false : 'negative-only'}
          color={account.kind === 'credit_card' && account.balanceMinor < 0 ? c.negative : undefined}
        />
      }
      onPress={onPress ?? (() => router.push(`/accounts/${account.id}`))}
      chevron
    />
  );
}
