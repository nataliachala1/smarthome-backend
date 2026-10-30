import {
  currentMonthInBogota,
  monthRangeInBogota,
  todayInBogota,
} from './bogota-date';

describe('todayInBogota', () => {
  it('usa el calendario de Bogotá (UTC-5) y no el de UTC', () => {
    // 2026-11-01 03:00 UTC = 2026-10-31 22:00 en Bogotá
    expect(todayInBogota(new Date('2026-11-01T03:00:00.000Z'))).toBe(
      '2026-10-31',
    );
    expect(todayInBogota(new Date('2026-11-01T05:00:00.000Z'))).toBe(
      '2026-11-01',
    );
  });
});

describe('currentMonthInBogota', () => {
  it('cambia de mes según Bogotá y no según UTC', () => {
    // 2026-12-01 02:00 UTC = 2026-11-30 21:00 en Bogotá
    expect(currentMonthInBogota(new Date('2026-12-01T02:00:00.000Z'))).toBe(
      '2026-11',
    );
  });
});

describe('monthRangeInBogota', () => {
  it('el mes va de medianoche a medianoche en Bogotá (UTC-5), fin excluido', () => {
    const { from, to } = monthRangeInBogota('2026-11');

    expect(from.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });

  it('diciembre termina el 1 de enero del año siguiente', () => {
    const { from, to } = monthRangeInBogota('2026-12');

    expect(from.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });
});
