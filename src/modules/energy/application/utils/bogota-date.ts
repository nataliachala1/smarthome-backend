export const ENERGY_TIMEZONE = 'America/Bogota';

const bogotaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ENERGY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Current calendar date in America/Bogota, YYYY-MM-DD format. */
export function todayInBogota(now: Date = new Date()): string {
  return bogotaDateFormatter.format(now);
}

/** Current calendar month in America/Bogota, YYYY-MM format. */
export function currentMonthInBogota(now: Date = new Date()): string {
  return todayInBogota(now).slice(0, 7);
}

/**
 * Colombia uses a fixed UTC-5 (no daylight saving time), so the offset is constant.
 */
const BOGOTA_UTC_OFFSET = '-05:00';

/**
 * Range [from, to) of the YYYY-MM month in America/Bogota, expressed as instants:
 * from = day 1 at 00:00 in Bogota; to = day 1 of the next month at 00:00.
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
