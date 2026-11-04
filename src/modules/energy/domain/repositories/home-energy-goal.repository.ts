import { HomeEnergyGoal } from '../entities/home-energy-goal.entity';

export interface UpsertHomeEnergyGoalData {
  homeId: string;
  /** Mes YYYY-MM. */
  month: string;
  monthlyBudgetCop: string | null;
  targetKwh: string | null;
}

/**
 * Puerto de persistencia de objetivos mensuales SQL034.
 * No existe borrado: la BD no concede DELETE a la aplicación.
 */
export abstract class HomeEnergyGoalRepository {
  abstract findByMonth(
    userId: string,
    homeId: string,
    month: string,
  ): Promise<HomeEnergyGoal | null>;

  /**
   * Crea el objetivo del mes o reemplaza sus dos valores (idempotente sobre
   * id_home + month_start). Solo actualiza monthly_budget_cop y target_kwh.
   */
  abstract upsert(
    userId: string,
    data: UpsertHomeEnergyGoalData,
  ): Promise<HomeEnergyGoal>;
}
