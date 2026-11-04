import { percentage, roundDecimal } from '../services/decimal-math';

/** Datos crudos del mes leídos de la BD (todos los decimales como texto exacto). */
export interface EnergyMonthFacts {
  /** Lecturas del período visibles para el usuario. */
  readingsCount: number;
  /** Lecturas con consumo distinto de 0 sin tarifa vigente en su fecha local. */
  unpricedReadings: number;
  /** SUM(energy_delta_kwh) de todas las lecturas del período. */
  totalKwh: string;
  /** SUM(energy_delta_kwh * tarifa de su fecha) de las lecturas con tarifa. */
  pricedCostCop: string;
  monthlyBudgetCop: string | null;
  targetKwh: string | null;
}

export interface HomeEnergySummary {
  homeId: string;
  month: string;
  timezone: string;
  from: Date;
  to: Date;
  readingsCount: number;
  unpricedReadings: number;
  totalKwh: string;
  /** true si todas las lecturas con consumo tienen tarifa aplicable. */
  costComplete: boolean;
  /** Costo estimado del mes; null si costComplete es false. */
  estimatedCostCop: string | null;
  /** Costo de las lecturas que sí tienen tarifa (igual al estimado si está completo). */
  partialCostCop: string;
  monthlyBudgetCop: string | null;
  targetKwh: string | null;
  /** estimatedCostCop / monthlyBudgetCop * 100; null sin presupuesto o sin costo completo. */
  budgetUsagePercent: string | null;
  /** totalKwh / targetKwh * 100; null sin meta. Puede superar 100. */
  targetUsagePercent: string | null;
  currency: 'COP';
}

export interface BuildHomeEnergySummaryInput {
  homeId: string;
  month: string;
  timezone: string;
  from: Date;
  to: Date;
  facts: EnergyMonthFacts;
}

/**
 * Reglas de negocio del resumen (SQL034, sección 5 del requerimiento):
 * - no se presenta un costo parcial como total: si falta tarifa en alguna lectura
 *   con consumo, estimatedCostCop es null y se informa la cobertura;
 * - los porcentajes no se recortan a 100 %.
 */
export function buildHomeEnergySummary(
  input: BuildHomeEnergySummaryInput,
): HomeEnergySummary {
  const { facts } = input;
  const costComplete = facts.unpricedReadings === 0;
  const partialCostCop = roundDecimal(facts.pricedCostCop, 2);
  const estimatedCostCop = costComplete ? partialCostCop : null;

  return {
    homeId: input.homeId,
    month: input.month,
    timezone: input.timezone,
    from: input.from,
    to: input.to,
    readingsCount: facts.readingsCount,
    unpricedReadings: facts.unpricedReadings,
    totalKwh: roundDecimal(facts.totalKwh, 6),
    costComplete,
    estimatedCostCop,
    partialCostCop,
    monthlyBudgetCop: facts.monthlyBudgetCop,
    targetKwh: facts.targetKwh,
    budgetUsagePercent:
      facts.monthlyBudgetCop !== null && estimatedCostCop !== null
        ? percentage(estimatedCostCop, facts.monthlyBudgetCop)
        : null,
    targetUsagePercent:
      facts.targetKwh !== null
        ? percentage(facts.totalKwh, facts.targetKwh)
        : null,
    currency: 'COP',
  };
}
