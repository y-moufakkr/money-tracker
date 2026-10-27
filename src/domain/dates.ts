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

/** A UTC timestamp shown in Casablanca time: "Today 14:05", "Mon 27 Oct 14:05". */
export function formatTimestamp(utc: string, today = todayISO()): string {
  const at = new Date(utc);
  if (Number.isNaN(at.getTime())) return utc;
  let time = utc.slice(11, 16);
  try {
    time = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  } catch {
    // No tz data: keep UTC.
  }
  return `${formatDateLabel(todayISO(at), today)} ${time}`;
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

export type Granularity = 'day' | 'week' | 'month' | 'year';

/** The calendar bucket (day, Monday-week, month, year) that contains `iso`. */
export function bucketRange(g: Granularity, iso: string): DateRange {
  switch (g) {
    case 'day':
      return { from: iso, to: iso };
    case 'week': {
      const from = startOfWeek(iso);
      return { from, to: addDays(from, 6) };
    }
    case 'month':
      return { from: startOfMonth(iso), to: endOfMonth(iso) };
    case 'year':
      return { from: startOfYear(iso), to: `${iso.slice(0, 4)}-12-31` };
  }
}

/**
 * End dates of the last `count` buckets, oldest first. The current bucket
 * ends today (balances are not projected into the future).
 */
export function trendDates(g: Granularity, count: number, today = todayISO()): string[] {
  const out: string[] = [];
  let anchor = today;
  for (let i = 0; i < count; i++) {
    const end = bucketRange(g, anchor).to;
    out.push(end > today ? today : end);
    const from = bucketRange(g, anchor).from;
    anchor = addDays(from, -1);
  }
  return out.reverse();
}

/** Short axis label for a bucket ending on `iso`. */
export function bucketLabel(g: Granularity, iso: string): string {
  const d = toUTC(iso);
  switch (g) {
    case 'day':
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    case 'week': {
      const s = toUTC(startOfWeek(iso));
      return `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`;
    }
    case 'month':
      return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
    case 'year':
      return String(d.getUTCFullYear());
  }
}
