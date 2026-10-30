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
