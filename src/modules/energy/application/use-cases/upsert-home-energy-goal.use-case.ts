import { Injectable } from '@nestjs/common';

import { assertEnergyGoalHasValue } from '../../domain/entities/home-energy-goal.entity';
import { HomeEnergyGoalRepository } from '../../domain/repositories/home-energy-goal.repository';
import {
  HomeEnergyGoalResponse,
  toHomeEnergyGoalResponse,
} from '../dto/home-energy-goal.response';
import { throwEnergyHttpError } from '../energy-http-error';

export interface UpsertHomeEnergyGoalInput {
  userId: string;
  homeId: string;
  month: string;
  monthlyBudgetCop: string | null;
  targetKwh: string | null;
}

/**
 * Crea o reemplaza el presupuesto y la meta del mes (PUT idempotente).
 * Política de concurrencia: última escritura gana.
 */
@Injectable()
export class UpsertHomeEnergyGoalUseCase {
  constructor(private readonly goalRepository: HomeEnergyGoalRepository) {}

  async execute(
    input: UpsertHomeEnergyGoalInput,
  ): Promise<HomeEnergyGoalResponse> {
    try {
      assertEnergyGoalHasValue(input.monthlyBudgetCop, input.targetKwh);

      const goal = await this.goalRepository.upsert(input.userId, {
        homeId: input.homeId,
        month: input.month,
        monthlyBudgetCop: input.monthlyBudgetCop,
        targetKwh: input.targetKwh,
      });

      return toHomeEnergyGoalResponse(goal);
    } catch (error) {
      throwEnergyHttpError(error);
    }
  }
}
