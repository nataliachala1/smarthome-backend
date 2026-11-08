import {
  currentMonthInBogota,
  monthRangeInBogota,
  todayInBogota,
} from './bogota-date';

describe('todayInBogota', () => {
  it('uses the Bogota calendar (UTC-5) and not UTC', () => {
    // 2026-11-01 03:00 UTC = 2026-10-31 22:00 in Bogota
    expect(todayInBogota(new Date('2026-11-01T03:00:00.000Z'))).toBe(
      '2026-10-31',
    );
    expect(todayInBogota(new Date('2026-11-01T05:00:00.000Z'))).toBe(
      '2026-11-01',
    );
  });
});

describe('currentMonthInBogota', () => {
  it('changes month according to Bogota and not UTC', () => {
    // 2026-12-01 02:00 UTC = 2026-11-30 21:00 in Bogota
    expect(currentMonthInBogota(new Date('2026-12-01T02:00:00.000Z'))).toBe(
      '2026-11',
    );
  });
});

describe('monthRangeInBogota', () => {
  it('the month runs from midnight to midnight in Bogota (UTC-5), end excluded', () => {
    const { from, to } = monthRangeInBogota('2026-11');

    expect(from.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });

  it('December ends on January 1 of the next year', () => {
    const { from, to } = monthRangeInBogota('2026-12');

    expect(from.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });
});
