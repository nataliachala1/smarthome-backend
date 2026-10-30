/** YYYY-MM con mes 01..12. */
export const ENERGY_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isEnergyMonth(value: unknown): value is string {
  return typeof value === 'string' && ENERGY_MONTH_PATTERN.test(value);
}
