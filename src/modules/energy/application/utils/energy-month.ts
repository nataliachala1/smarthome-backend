/**
 * Rango técnico de años admitido para fechas y meses de energía (2000–2099).
 * Evita valores que PostgreSQL o JavaScript no pueden representar (año 0000,
 * mes siguiente a 9999-12) y que terminarían en errores 500. Si el negocio
 * necesita otro rango, se ajusta solo aquí.
 */
export const ENERGY_MIN_YEAR = 2000;
export const ENERGY_MAX_YEAR = 2099;

/** YYYY-MM con año 2000–2099 y mes 01..12. */
export const ENERGY_MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/;

/** YYYY-MM-DD con año 2000–2099 (la validez del día la comprueba IsISO8601). */
export const ENERGY_DATE_PATTERN =
  /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const ENERGY_MONTH_MESSAGE =
  'debe tener formato YYYY-MM, con año entre 2000 y 2099 y mes entre 01 y 12';

export const ENERGY_DATE_MESSAGE =
  'debe tener formato YYYY-MM-DD, con año entre 2000 y 2099';

export function isEnergyMonth(value: unknown): value is string {
  return typeof value === 'string' && ENERGY_MONTH_PATTERN.test(value);
}
