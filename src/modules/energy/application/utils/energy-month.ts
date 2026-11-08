/**
 * Technical range of years accepted for energy dates and months (2000–2099).
 * Prevents values that PostgreSQL or JavaScript cannot represent (year 0000,
 * the month after 9999-12) and that would end in 500 errors. If the business
 * needs another range, adjust it only here.
 */
export const ENERGY_MIN_YEAR = 2000;
export const ENERGY_MAX_YEAR = 2099;

/** YYYY-MM with year 2000–2099 and month 01..12. */
export const ENERGY_MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/;

/** YYYY-MM-DD with year 2000–2099 (IsISO8601 checks the day validity). */
export const ENERGY_DATE_PATTERN =
  /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const ENERGY_MONTH_MESSAGE =
  'debe tener formato YYYY-MM, con año entre 2000 y 2099 y mes entre 01 y 12';

export const ENERGY_DATE_MESSAGE =
  'debe tener formato YYYY-MM-DD, con año entre 2000 y 2099';

export function isEnergyMonth(value: unknown): value is string {
  return typeof value === 'string' && ENERGY_MONTH_PATTERN.test(value);
}
