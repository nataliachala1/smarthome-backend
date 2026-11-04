import { EnergyMonthFacts } from '../entities/home-energy-summary';

export interface EnergyMonthPeriod {
  homeId: string;
  /** Mes YYYY-MM (para leer presupuesto y meta). */
  month: string;
  /** Inicio del mes en America/Bogota (incluido). */
  from: Date;
  /** Inicio del mes siguiente en America/Bogota (excluido). */
  to: Date;
}

/** Puerto de lectura de los datos crudos del resumen energético mensual. */
export abstract class HomeEnergySummaryRepository {
  abstract getMonthFacts(
    userId: string,
    period: EnergyMonthPeriod,
  ): Promise<EnergyMonthFacts>;
}
