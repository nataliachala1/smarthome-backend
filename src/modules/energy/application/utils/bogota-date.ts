export const ENERGY_TIMEZONE = 'America/Bogota';

const bogotaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ENERGY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha calendario actual en America/Bogota, formato YYYY-MM-DD. */
export function todayInBogota(now: Date = new Date()): string {
  return bogotaDateFormatter.format(now);
}

/** Mes calendario actual en America/Bogota, formato YYYY-MM. */
export function currentMonthInBogota(now: Date = new Date()): string {
  return todayInBogota(now).slice(0, 7);
}

/**
 * Colombia usa UTC-5 fijo (sin horario de verano), por eso el desfase es constante.
 */
const BOGOTA_UTC_OFFSET = '-05:00';

/**
 * Rango [from, to) del mes YYYY-MM en America/Bogota, expresado como instantes:
 * from = día 1 a las 00:00 en Bogotá; to = día 1 del mes siguiente a las 00:00.
 */
export function monthRangeInBogota(month: string): { from: Date; to: Date } {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const pad = (value: number) => String(value).padStart(2, '0');

  return {
    from: new Date(month + '-01T00:00:00' + BOGOTA_UTC_OFFSET),
    to: new Date(
      String(nextYear) +
        '-' +
        pad(nextMonth) +
        '-01T00:00:00' +
        BOGOTA_UTC_OFFSET,
    ),
  };
}
