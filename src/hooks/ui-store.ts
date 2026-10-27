import { create } from 'zustand';

import { todayISO, type DateRange, type Granularity, type PeriodPreset } from '@/domain/dates';
import type { AnalyticsFilter, Dimension } from '@/services/analytics';

export type AnalyticsPeriod = PeriodPreset | 'custom';

type UiState = {
  transactionsPeriod: PeriodPreset | 'all';
  analyticsPeriod: AnalyticsPeriod;
  analyticsCustom: DateRange;
  analyticsDimension: Dimension;
  analyticsFilter: AnalyticsFilter | null;
  trendGranularity: Granularity;
  setTransactionsPeriod: (p: PeriodPreset | 'all') => void;
  setAnalyticsPeriod: (p: AnalyticsPeriod) => void;
  setAnalyticsCustom: (r: DateRange) => void;
  setAnalyticsDimension: (d: Dimension) => void;
  setAnalyticsFilter: (f: AnalyticsFilter | null) => void;
  setTrendGranularity: (g: Granularity) => void;
};

/** Ephemeral UI preferences shared between tabs (not persisted). */
export const useUiStore = create<UiState>((set) => ({
  transactionsPeriod: 'all',
  analyticsPeriod: 'this_month',
  analyticsCustom: { from: todayISO().slice(0, 8) + '01', to: todayISO() },
  analyticsDimension: 'category',
  analyticsFilter: null,
  trendGranularity: 'month',
  setTransactionsPeriod: (transactionsPeriod) => set({ transactionsPeriod }),
  setAnalyticsPeriod: (analyticsPeriod) => set({ analyticsPeriod }),
  setAnalyticsCustom: (analyticsCustom) => set({ analyticsCustom, analyticsPeriod: 'custom' }),
  setAnalyticsDimension: (analyticsDimension) => set({ analyticsDimension }),
  setAnalyticsFilter: (analyticsFilter) => set({ analyticsFilter }),
  setTrendGranularity: (trendGranularity) => set({ trendGranularity }),
}));
