import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { useColorScheme } from 'react-native';

/**
 * Colour roles carry meaning across the app:
 * - primary  → personal money
 * - business → company funds (never mixed into personal totals)
 * - negative → spending and liabilities
 * - estimate → projections that are not real money yet
 */
const light = {
  bg: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceAlt: '#EDEFF2',
  border: '#E1E4E9',
  text: '#11151C',
  textMuted: '#5D6470',
  textFaint: '#8A909C',
  primary: '#0B7A64',
  primarySoft: '#DCF1EA',
  onPrimary: '#FFFFFF',
  business: '#4B44D6',
  businessSoft: '#E7E6FB',
  positive: '#13804B',
  negative: '#C2362F',
  negativeSoft: '#FBE6E4',
  warning: '#A85A06',
  warningSoft: '#FCEFD9',
  estimate: '#8C6400',
  estimateSoft: '#FBF3DD',
  scrim: 'rgba(10, 12, 16, 0.45)',
};

const dark: typeof light = {
  bg: '#0B0D11',
  surface: '#15181F',
  surfaceAlt: '#1E222B',
  border: '#2A2F39',
  text: '#EEF1F5',
  textMuted: '#A4ABB8',
  textFaint: '#727987',
  primary: '#3CC6A2',
  primarySoft: '#123A31',
  onPrimary: '#04140F',
  business: '#8F8AFF',
  businessSoft: '#25244B',
  positive: '#4CC283',
  negative: '#FF6E64',
  negativeSoft: '#3B1B19',
  warning: '#F0A43C',
  warningSoft: '#3A2A12',
  estimate: '#E8BF4F',
  estimateSoft: '#352B10',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

export type Colors = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 } as const;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useNavigationTheme(): Theme {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? dark : light;
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.bg,
      card: c.surface,
      text: c.text,
      border: c.border,
    },
  };
}

/** Distinct, accessible series colours for location breakdowns. */
export const SERIES = ['#0B7A64', '#3E7BD6', '#D0892A', '#8B5CC7', '#C24A6E', '#2A9BA8', '#6B8E23', '#7A6F5A'];
