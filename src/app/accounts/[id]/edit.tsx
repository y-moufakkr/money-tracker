import { useLocalSearchParams } from 'expo-router';

import { AccountForm } from '@/components/account-form';
import { useAccount, useAccountLedger } from '@/hooks/data';
import { Loading } from '@/ui/primitives';

export default function EditAccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useAccount(id);
  const ledger = useAccountLedger(account.data);
  if (!account.data || !ledger.data) return <Loading />;
  return <AccountForm existing={account.data} hasHistory={ledger.data.length > 0} />;
}
