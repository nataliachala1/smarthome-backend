import { EnergyMonthFacts } from '../entities/home-energy-summary';

export interface EnergyMonthPeriod {
  homeId: string;
  /** Month YYYY-MM (to read the budget and target). */
  month: string;
  /** Start of the month in America/Bogota (included). */
  from: Date;
  /** Start of the next month in America/Bogota (excluded). */
  to: Date;
}

/** Read port for the raw data of the monthly energy summary. */
export abstract class HomeEnergySummaryRepository {
  abstract getMonthFacts(
    userId: string,
    period: EnergyMonthPeriod,
  ): Promise<EnergyMonthFacts>;
}
