import type { home_energy_goal as PrismaHomeEnergyGoal } from '../../../../../generated/prisma/client';

import { HomeEnergyGoal } from '../../domain/entities/home-energy-goal.entity';
import { fromDbDate, toDbDate } from './prisma-home-energy-tariff.mapper';

/** 'YYYY-MM' -> Date del día 1 del mes (columna DATE month_start). */
export function monthToDbDate(month: string): Date {
  return toDbDate(month + '-01');
}

/** DATE month_start -> 'YYYY-MM'. */
export function dbDateToMonth(date: Date): string {
  return fromDbDate(date).slice(0, 7);
}

export class PrismaHomeEnergyGoalMapper {
  static toDomain(raw: PrismaHomeEnergyGoal): HomeEnergyGoal {
    return new HomeEnergyGoal({
      id: raw.id_home_energy_goal,
      homeId: raw.id_home,
      month: dbDateToMonth(raw.month_start),
      monthlyBudgetCop:
        raw.monthly_budget_cop === null
          ? null
          : raw.monthly_budget_cop.toFixed(2),
      targetKwh: raw.target_kwh === null ? null : raw.target_kwh.toFixed(6),
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    });
  }
}
