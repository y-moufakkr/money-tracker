import { addDays, addMonths, formatDateLabel, isValidISODate, presetRange, startOfWeek, todayISO } from './dates';

describe('dates', () => {
  it('uses the Casablanca calendar for today', () => {
    // 23:30 UTC on 31 Dec 2025 is already 1 Jan 2026 in Casablanca (UTC+1).
    expect(todayISO(new Date('2025-12-31T23:30:00Z'))).toBe('2026-01-01');
    expect(todayISO(new Date('2026-06-15T10:00:00Z'))).toBe('2026-06-15');
  });

  it('does date arithmetic without timezone drift', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(startOfWeek('2026-10-29')).toBe('2026-10-26');
    expect(isValidISODate('2026-02-30')).toBe(false);
  });

  it('builds preset ranges', () => {
    const today = '2026-10-27';
    expect(presetRange('this_month', today)).toEqual({ from: '2026-10-01', to: today });
    expect(presetRange('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('last_week', today)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(presetRange('last_30', today).from).toBe('2026-09-28');
  });

  it('labels dates', () => {
    expect(formatDateLabel('2026-10-27', '2026-10-27')).toBe('Today');
    expect(formatDateLabel('2026-10-26', '2026-10-27')).toBe('Yesterday');
    expect(formatDateLabel('2026-10-20', '2026-10-27')).toBe('Tue 20 Oct');
    expect(formatDateLabel('2025-10-20', '2026-10-27')).toBe('20 Oct 2025');
  });
});
