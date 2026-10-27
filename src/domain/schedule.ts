/**
 * Pure recurrence maths for recurring bills and expected income. Every due date is computed from
 * the first due date (never from the previous one), so a monthly bill on the 31st stays on the
 * last day of short months and returns to the 31st afterwards.
 */
import { addDays, addMonths, daysBetweenInclusive } from './dates';

export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

export type Schedule = {
  /** First due date (YYYY-MM-DD). */
  startDate: string;
  /** Last possible due date, inclusive. */
  endDate: string | null;
  unit: IntervalUnit;
  /** Every `count` units (1 = every month, 3 = every quarter…). */
  count: number;
};

/** Safety cap on generated dates per call (a daily bill over 13 years). */
export const MAX_OCCURRENCES = 5000;

export const FREQUENCY_PRESETS: { label: string; unit: IntervalUnit; count: number }[] = [
  { label: 'Weekly', unit: 'week', count: 1 },
  { label: 'Monthly', unit: 'month', count: 1 },
  { label: 'Every 2 months', unit: 'month', count: 2 },
  { label: 'Quarterly', unit: 'month', count: 3 },
  { label: 'Every 6 months', unit: 'month', count: 6 },
  { label: 'Yearly', unit: 'year', count: 1 },
];

/** The n-th due date (0 = the first). */
export function nthDueDate(s: Pick<Schedule, 'startDate' | 'unit' | 'count'>, n: number): string {
  switch (s.unit) {
    case 'day':
      return addDays(s.startDate, n * s.count);
    case 'week':
      return addDays(s.startDate, n * s.count * 7);
    case 'month':
      return addMonths(s.startDate, n * s.count);
    case 'year':
      return addMonths(s.startDate, n * s.count * 12);
  }
}

/** A first index whose date is ≤ `from`, so the scan does not start at the first due date. */
function firstIndexNear(s: Schedule, from: string): number {
  if (from <= s.startDate) return 0;
  const days = daysBetweenInclusive(s.startDate, from) - 1;
  const step = s.unit === 'day' ? s.count : s.unit === 'week' ? s.count * 7 : s.unit === 'month' ? s.count * 28 : s.count * 365;
  // Months have ≥ 28 days and years ≥ 365, so this never skips past `from` for day/week, and for
  // month/year it may overshoot by a little: step back to be safe.
  const n = Math.floor(days / step);
  return s.unit === 'day' || s.unit === 'week' ? n : Math.max(0, Math.floor(n * (28 / 31)) - 1);
}

/** Due dates in [from, to], ascending. */
export function dueDatesBetween(s: Schedule, from: string, to: string): string[] {
  const out: string[] = [];
  const last = s.endDate && s.endDate < to ? s.endDate : to;
  if (last < s.startDate || last < from) return out;
  for (let n = firstIndexNear(s, from), i = 0; i < MAX_OCCURRENCES; n++, i++) {
    const d = nthDueDate(s, n);
    if (d > last) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** Whether `date` is one of the schedule's due dates. */
export function isDueDate(s: Schedule, date: string): boolean {
  return dueDatesBetween(s, date, date).length === 1;
}

/** The first due date on or after `date`, or null when the schedule has ended. */
export function nextDueDate(s: Schedule, date: string): string | null {
  for (let n = firstIndexNear(s, date), i = 0; i < MAX_OCCURRENCES; n++, i++) {
    const d = nthDueDate(s, n);
    if (s.endDate && d > s.endDate) return null;
    if (d >= date) return d;
  }
  return null;
}

export function frequencyLabel(unit: IntervalUnit, count: number): string {
  const preset = FREQUENCY_PRESETS.find((p) => p.unit === unit && p.count === count);
  if (preset) return preset.label;
  if (unit === 'day' && count === 1) return 'Daily';
  if (unit === 'year' && count > 1) return `Every ${count} years`;
  return `Every ${count} ${unit}${count === 1 ? '' : 's'}`;
}
