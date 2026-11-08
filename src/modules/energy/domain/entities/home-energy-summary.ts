import { percentage, roundDecimal } from '../services/decimal-math';

/** Raw month data read from the DB (every decimal as exact text). */
export interface EnergyMonthFacts {
  /** Readings of the period visible to the user. */
  readingsCount: number;
  /** Readings with non-zero consumption and no tariff effective on their local date. */
  unpricedReadings: number;
  /** SUM(energy_delta_kwh) of every reading of the period. */
  totalKwh: string;
  /** SUM(energy_delta_kwh * tariff of its date) of the readings with a tariff. */
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
  /** true when every reading with consumption has an applicable tariff. */
  costComplete: boolean;
  /** Estimated cost of the month; null when costComplete is false. */
  estimatedCostCop: string | null;
  /** Cost of the readings that do have a tariff (equal to the estimate when complete). */
  partialCostCop: string;
  monthlyBudgetCop: string | null;
  targetKwh: string | null;
  /** estimatedCostCop / monthlyBudgetCop * 100; null without a budget or a complete cost. */
  budgetUsagePercent: string | null;
  /** totalKwh / targetKwh * 100; null without a target. May exceed 100. */
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
 * Business rules of the summary (SQL034, section 5 of the requirement):
 * - a partial cost is never presented as the total: if a reading with consumption
 *   has no tariff, estimatedCostCop is null and the coverage is reported;
 * - percentages are not capped at 100 %.
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
