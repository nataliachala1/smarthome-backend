import { Injectable } from '@nestjs/common';

import { HomeEnergyTariffRepository } from '../../domain/repositories/home-energy-tariff.repository';
import {
  HomeEnergyTariffResponse,
  toHomeEnergyTariffResponse,
} from '../dto/home-energy-tariff.response';
import { throwEnergyHttpError } from '../energy-http-error';

export interface CreateHomeEnergyTariffInput {
  userId: string;
  homeId: string;
  unitPriceCopKwh: string;
  effectiveFrom: string;
}

/**
 * Records a new tariff effective period. Historical tariffs are not edited:
 * a price change is always an INSERT with another effective date.
 */
@Injectable()
export class CreateHomeEnergyTariffUseCase {
  constructor(private readonly tariffRepository: HomeEnergyTariffRepository) {}

  async execute(
    input: CreateHomeEnergyTariffInput,
  ): Promise<HomeEnergyTariffResponse> {
    try {
      const tariff = await this.tariffRepository.create(input.userId, {
        homeId: input.homeId,
        unitPriceCopKwh: input.unitPriceCopKwh,
        effectiveFrom: input.effectiveFrom,
      });

      return toHomeEnergyTariffResponse(tariff);
    } catch (error) {
      throwEnergyHttpError(error);
    }
  }
}
