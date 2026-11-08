import { dbDateToMonth, monthToDbDate } from './prisma-home-energy-goal.mapper';

describe('Month conversion for month_start', () => {
  it('always stores the first day of the month without shifting the time zone', () => {
    expect(monthToDbDate('2026-11').toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(dbDateToMonth(new Date('2026-11-01T00:00:00.000Z'))).toBe('2026-11');
  });
});
