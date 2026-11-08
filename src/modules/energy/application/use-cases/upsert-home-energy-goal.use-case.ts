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
 * Creates or replaces the budget and target of the month (idempotent PUT).
 * Concurrency policy: last write wins.
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
