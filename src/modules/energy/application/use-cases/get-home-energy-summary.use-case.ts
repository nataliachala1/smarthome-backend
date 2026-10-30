import { Injectable } from '@nestjs/common';

import { buildHomeEnergySummary } from '../../domain/entities/home-energy-summary';
import { HomeEnergySummaryRepository } from '../../domain/repositories/home-energy-summary.repository';
import {
  HomeEnergySummaryResponse,
  toHomeEnergySummaryResponse,
} from '../dto/home-energy-summary.response';
import { throwEnergyHttpError } from '../energy-http-error';
import {
  ENERGY_TIMEZONE,
  currentMonthInBogota,
  monthRangeInBogota,
} from '../utils/bogota-date';

export interface GetHomeEnergySummaryInput {
  userId: string;
  homeId: string;
  /** Mes YYYY-MM; si no llega se usa el mes actual en America/Bogota. */
  month?: string;
}

/**
 * Resumen mensual: kWh del mes y costo estimado aplicando a cada lectura la
 * tarifa vigente en su fecha local (America/Bogota). Solo OWNER o MEMBER autorizado.
 */
@Injectable()
export class GetHomeEnergySummaryUseCase {
  constructor(
    private readonly summaryRepository: HomeEnergySummaryRepository,
  ) {}

  async execute(
    input: GetHomeEnergySummaryInput,
  ): Promise<HomeEnergySummaryResponse> {
    const month = input.month ?? currentMonthInBogota();
    const { from, to } = monthRangeInBogota(month);

    try {
      const facts = await this.summaryRepository.getMonthFacts(input.userId, {
        homeId: input.homeId,
        month,
        from,
        to,
      });

      return toHomeEnergySummaryResponse(
        buildHomeEnergySummary({
          homeId: input.homeId,
          month,
          timezone: ENERGY_TIMEZONE,
          from,
          to,
          facts,
        }),
      );
    } catch (error) {
      throwEnergyHttpError(error);
    }
  }
}
