/**
 * Calendar dates are stored as 'YYYY-MM-DD' strings in the Africa/Casablanca
 * calendar. All arithmetic is done on UTC midnights so device timezone and DST
 * never shift a date.
 */

export const APP_TIME_ZONE = 'Africa/Casablanca';

let formatter: Intl.DateTimeFormat | null | undefined;

function casablancaFormatter(): Intl.DateTimeFormat | null {
  if (formatter !== undefined) return formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    formatter = null;
  }
  return formatter;
}

/** Today's date in Casablanca (falls back to the device's local date if Intl lacks tz data). */
export function todayISO(now: Date = new Date()): string {
  const f = casablancaFormatter();
  if (f) {
    const parts = f.formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const iso = `${get('year')}-${get('month')}-${get('day')}`;
    if (isValidISODate(iso)) return iso;
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = toUTC(s);
  return !Number.isNaN(d.getTime()) && fromUTC(d) === s;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(iso: string, days: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = daysInMonth(fromUTC(target));
  target.setUTCDate(Math.min(day, lastDay));
  return fromUTC(target);
}

export function daysInMonth(iso: string): number {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + '01';
}

export function endOfMonth(iso: string): string {
  return iso.slice(0, 8) + pad(daysInMonth(iso));
}

/** Weeks start on Monday. */
export function startOfWeek(iso: string): string {
  const dow = (toUTC(iso).getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

export function startOfYear(iso: string): string {
  return iso.slice(0, 4) + '-01-01';
}

/** Inclusive count of days between two dates. */
export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / 86_400_000) + 1;
}

export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Yesterday", "Mon 27 Oct", or "27 Oct 2024" for other years. */
export function formatDateLabel(iso: string, today = todayISO()): string {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const d = toUTC(iso);
  const day = d.getUTCDate();
  const mon = MONTHS[d.getUTCMonth()];
  if (iso.slice(0, 4) !== today.slice(0, 4)) return `${day} ${mon} ${d.getUTCFullYear()}`;
  return `${WEEKDAYS[d.getUTCDay()]} ${day} ${mon}`;
}

export function formatMonthLabel(iso: string): string {
  const d = toUTC(iso);
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function localDateToISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type DateRange = { from: string; to: string };

export type PeriodPreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_30'
  | 'last_90'
  | 'this_year'
  | 'last_year';

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  last_30: 'Last 30 days',
  last_90: 'Last 90 days',
  this_year: 'This year',
  last_year: 'Previous year',
};

export function presetRange(preset: PeriodPreset, today = todayISO()): DateRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'this_week':
      return { from: startOfWeek(today), to: today };
    case 'last_week': {
      const start = addDays(startOfWeek(today), -7);
      return { from: start, to: addDays(start, 6) };
    }
    case 'this_month':
      return { from: startOfMonth(today), to: today };
    case 'last_month': {
      const start = addMonths(startOfMonth(today), -1);
      return { from: start, to: endOfMonth(start) };
    }
    case 'last_30':
      return { from: addDays(today, -29), to: today };
    case 'last_90':
      return { from: addDays(today, -89), to: today };
    case 'this_year':
      return { from: startOfYear(today), to: today };
    case 'last_year': {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
  }
}
