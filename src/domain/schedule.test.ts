import { addDays } from './dates';
import { dueDatesBetween, frequencyLabel, isDueDate, nextDueDate, nthDueDate, type Schedule } from './schedule';

const monthly = (startDate: string, endDate: string | null = null): Schedule => ({ startDate, endDate, unit: 'month', count: 1 });

describe('recurrence schedules', () => {
  it('keeps a bill on the 31st at the end of short months and returns to the 31st', () => {
    const s = monthly('2026-01-31');
    expect([0, 1, 2, 3, 4].map((n) => nthDueDate(s, n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('handles quarterly, yearly on 29 February, weekly and daily schedules', () => {
    expect(dueDatesBetween({ startDate: '2026-01-15', endDate: null, unit: 'month', count: 3 }, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15',
    ]);
    const leap: Schedule = { startDate: '2028-02-29', endDate: null, unit: 'year', count: 1 };
    expect([0, 1, 4].map((n) => nthDueDate(leap, n))).toEqual(['2028-02-29', '2029-02-28', '2032-02-29']);
    expect(dueDatesBetween({ startDate: '2026-10-05', endDate: null, unit: 'week', count: 2 }, '2026-10-01', '2026-11-05')).toEqual([
      '2026-10-05',
      '2026-10-19',
      '2026-11-02',
    ]);
    expect(dueDatesBetween({ startDate: '2026-10-30', endDate: '2026-11-02', unit: 'day', count: 1 }, '2026-01-01', '2027-01-01')).toHaveLength(4);
  });

  it('respects the end date and returns nothing before the first due date', () => {
    const s = monthly('2026-03-10', '2026-06-10');
    expect(dueDatesBetween(s, '2026-01-01', '2027-01-01')).toEqual(['2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10']);
    expect(dueDatesBetween(s, '2026-01-01', '2026-03-09')).toEqual([]);
    expect(nextDueDate(s, '2026-06-11')).toBeNull();
    expect(nextDueDate(s, '2026-04-11')).toBe('2026-05-10');
  });

  it('starting a scan far after the first due date gives the same dates as a full scan', () => {
    const cases: Schedule[] = [
      { startDate: '2019-01-31', endDate: null, unit: 'month', count: 1 },
      { startDate: '2019-03-29', endDate: null, unit: 'month', count: 5 },
      { startDate: '2016-02-29', endDate: null, unit: 'year', count: 1 },
      { startDate: '2015-12-31', endDate: null, unit: 'year', count: 3 },
      { startDate: '2020-06-01', endDate: null, unit: 'week', count: 3 },
      { startDate: '2024-06-01', endDate: null, unit: 'day', count: 10 },
    ];
    for (const s of cases) {
      const all = dueDatesBetween(s, s.startDate, '2031-12-31');
      for (let from = '2025-01-01'; from < '2027-01-01'; from = addDays(from, 37)) {
        const to = addDays(from, 400);
        expect(dueDatesBetween(s, from, to)).toEqual(all.filter((d) => d >= from && d <= to));
      }
      for (const d of all.slice(-5)) expect(isDueDate(s, d)).toBe(true);
      expect(isDueDate(s, addDays(all[all.length - 1], 1))).toBe(false);
    }
  });

  it('labels frequencies', () => {
    expect(frequencyLabel('month', 1)).toBe('Monthly');
    expect(frequencyLabel('month', 3)).toBe('Quarterly');
    expect(frequencyLabel('year', 1)).toBe('Yearly');
    expect(frequencyLabel('day', 10)).toBe('Every 10 days');
    expect(frequencyLabel('year', 2)).toBe('Every 2 years');
  });
});
