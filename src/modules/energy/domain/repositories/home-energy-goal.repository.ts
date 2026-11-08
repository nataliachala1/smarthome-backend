import { HomeEnergyGoal } from '../entities/home-energy-goal.entity';

export interface UpsertHomeEnergyGoalData {
  homeId: string;
  /** Mes YYYY-MM. */
  month: string;
  monthlyBudgetCop: string | null;
  targetKwh: string | null;
}

/**
 * Persistence port for SQL034 monthly goals.
 * There is no delete: the DB does not grant DELETE to the application.
 */
export abstract class HomeEnergyGoalRepository {
  abstract findByMonth(
    userId: string,
    homeId: string,
    month: string,
  ): Promise<HomeEnergyGoal | null>;

  /**
   * Creates the month goal or replaces its two values (idempotent on
   * id_home + month_start). Only updates monthly_budget_cop and target_kwh.
   */
  abstract upsert(
    userId: string,
    data: UpsertHomeEnergyGoalData,
  ): Promise<HomeEnergyGoal>;
}
