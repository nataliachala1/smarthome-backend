import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../../generated/prisma/client';
import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import { isPostgresAccessDeniedError } from '../../../../infrastructure/database/prisma/prisma-error.util';

import { HomeEnergyGoal } from '../../domain/entities/home-energy-goal.entity';
import {
  EnergyGoalConcurrentWriteError,
  EnergyManageAccessDeniedError,
} from '../../domain/errors/energy.errors';
import {
  HomeEnergyGoalRepository,
  UpsertHomeEnergyGoalData,
} from '../../domain/repositories/home-energy-goal.repository';

import {
  assertCanManageEnergy,
  assertCanReadEnergy,
  isUniqueViolation,
} from './energy-access';
import {
  PrismaHomeEnergyGoalMapper,
  monthToDbDate,
} from './prisma-home-energy-goal.mapper';

/**
 * Objetivos mensuales SQL034 bajo RLS (withUserContext):
 * - lectura: consumption.fn_can_read_detail
 * - escritura: homes.fn_can_manage_home; la app solo puede actualizar
 *   monthly_budget_cop y target_kwh (grants por columna). updated_at lo pone el trigger.
 */
@Injectable()
export class PrismaHomeEnergyGoalRepository implements HomeEnergyGoalRepository {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async findByMonth(
    userId: string,
    homeId: string,
    month: string,
  ): Promise<HomeEnergyGoal | null> {
    return this.run(userId, async (tx) => {
      await assertCanReadEnergy(tx, homeId);

      const row = await tx.home_energy_goal.findUnique({
        where: {
          id_home_month_start: {
            id_home: homeId,
            month_start: monthToDbDate(month),
          },
        },
      });

      return row ? PrismaHomeEnergyGoalMapper.toDomain(row) : null;
    });
  }

  async upsert(
    userId: string,
    data: UpsertHomeEnergyGoalData,
  ): Promise<HomeEnergyGoal> {
    return this.run(userId, async (tx) => {
      await assertCanManageEnergy(tx, data.homeId);

      const monthStart = monthToDbDate(data.month);

      const row = await tx.home_energy_goal.upsert({
        where: {
          id_home_month_start: {
            id_home: data.homeId,
            month_start: monthStart,
          },
        },
        create: {
          id_home: data.homeId,
          month_start: monthStart,
          monthly_budget_cop: data.monthlyBudgetCop,
          target_kwh: data.targetKwh,
        },
        update: {
          monthly_budget_cop: data.monthlyBudgetCop,
          target_kwh: data.targetKwh,
        },
      });

      return PrismaHomeEnergyGoalMapper.toDomain(row);
    });
  }

  private async run<T>(
    userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prismaRls.withUserContext(userId, operation);
    } catch (error) {
      if (isPostgresAccessDeniedError(error)) {
        throw new EnergyManageAccessDeniedError();
      }

      if (isUniqueViolation(error)) {
        throw new EnergyGoalConcurrentWriteError();
      }

      throw error;
    }
  }
}
