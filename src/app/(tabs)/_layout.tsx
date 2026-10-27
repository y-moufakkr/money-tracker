import { NativeTabs } from 'expo-router/native-tabs';

import { useColors } from '@/ui/theme';

export default function TabLayout() {
  const c = useColors();
  return (
    <NativeTabs
      backgroundColor={c.surface}
      indicatorColor={c.primarySoft}
      iconColor={{ default: c.textMuted, selected: c.primary }}
      labelStyle={{ default: { color: c.textMuted }, selected: { color: c.primary } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="transactions">
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet" md="receipt_long" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="money">
        <NativeTabs.Trigger.Label>My Money</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="banknote" md="account_balance_wallet" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="analytics">
        <NativeTabs.Trigger.Label>Analytics</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.pie" md="donut_large" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="goals">
        <NativeTabs.Trigger.Label>Goals</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="flag" md="flag" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
