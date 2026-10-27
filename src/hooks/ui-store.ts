import { create } from 'zustand';

import type { PeriodPreset } from '@/domain/dates';

type UiState = {
  transactionsPeriod: PeriodPreset | 'all';
  analyticsPeriod: PeriodPreset;
  setTransactionsPeriod: (p: PeriodPreset | 'all') => void;
  setAnalyticsPeriod: (p: PeriodPreset) => void;
};

/** Ephemeral UI preferences shared between tabs (not persisted). */
export const useUiStore = create<UiState>((set) => ({
  transactionsPeriod: 'all',
  analyticsPeriod: 'this_month',
  setTransactionsPeriod: (transactionsPeriod) => set({ transactionsPeriod }),
  setAnalyticsPeriod: (analyticsPeriod) => set({ analyticsPeriod }),
}));
