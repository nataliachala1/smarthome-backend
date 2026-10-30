import { dbDateToMonth, monthToDbDate } from './prisma-home-energy-goal.mapper';

describe('Conversión de mes para month_start', () => {
  it('guarda siempre el día 1 del mes sin desplazar zona horaria', () => {
    expect(monthToDbDate('2026-11').toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(dbDateToMonth(new Date('2026-11-01T00:00:00.000Z'))).toBe('2026-11');
  });
});
