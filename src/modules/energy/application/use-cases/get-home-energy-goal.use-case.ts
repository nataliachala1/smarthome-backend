import { Injectable } from '@nestjs/common';

import { HomeEnergyGoalRepository } from '../../domain/repositories/home-energy-goal.repository';
import {
  MonthHomeEnergyGoalResponse,
  toHomeEnergyGoalResponse,
} from '../dto/home-energy-goal.response';
import { throwEnergyHttpError } from '../energy-http-error';
import { currentMonthInBogota } from '../utils/bogota-date';

export interface GetHomeEnergyGoalInput {
  userId: string;
  homeId: string;
  /** Mes YYYY-MM; si no llega se usa el mes actual en America/Bogota. */
  month?: string;
}

@Injectable()
export class GetHomeEnergyGoalUseCase {
  constructor(private readonly goalRepository: HomeEnergyGoalRepository) {}

  async execute(
    input: GetHomeEnergyGoalInput,
  ): Promise<MonthHomeEnergyGoalResponse> {
    const month = input.month ?? currentMonthInBogota();

    try {
      const goal = await this.goalRepository.findByMonth(
        input.userId,
        input.homeId,
        month,
      );

      return {
        homeId: input.homeId,
        month,
        goal: goal ? toHomeEnergyGoalResponse(goal) : null,
      };
    } catch (error) {
      throwEnergyHttpError(error);
    }
  }
}
