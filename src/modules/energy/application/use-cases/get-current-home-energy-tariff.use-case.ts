import { Injectable } from '@nestjs/common';

import { HomeEnergyTariffRepository } from '../../domain/repositories/home-energy-tariff.repository';
import {
  CurrentHomeEnergyTariffResponse,
  toHomeEnergyTariffResponse,
} from '../dto/home-energy-tariff.response';
import { throwEnergyHttpError } from '../energy-http-error';
import { todayInBogota } from '../utils/bogota-date';

export interface GetCurrentHomeEnergyTariffInput {
  userId: string;
  homeId: string;
  /** Fecha local YYYY-MM-DD; si no llega se usa hoy en America/Bogota. */
  at?: string;
}

@Injectable()
export class GetCurrentHomeEnergyTariffUseCase {
  constructor(private readonly tariffRepository: HomeEnergyTariffRepository) {}

  async execute(
    input: GetCurrentHomeEnergyTariffInput,
  ): Promise<CurrentHomeEnergyTariffResponse> {
    const at = input.at ?? todayInBogota();

    try {
      const tariff = await this.tariffRepository.findEffectiveAt(
        input.userId,
        input.homeId,
        at,
      );

      return {
        homeId: input.homeId,
        at,
        tariff: tariff ? toHomeEnergyTariffResponse(tariff) : null,
      };
    } catch (error) {
      throwEnergyHttpError(error);
    }
  }
}
