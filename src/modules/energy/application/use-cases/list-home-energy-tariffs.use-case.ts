import { Injectable } from '@nestjs/common';

import { HomeEnergyTariffRepository } from '../../domain/repositories/home-energy-tariff.repository';
import {
  HomeEnergyTariffListResponse,
  toHomeEnergyTariffResponse,
} from '../dto/home-energy-tariff.response';
import { throwEnergyHttpError } from '../energy-http-error';

export interface ListHomeEnergyTariffsInput {
  userId: string;
  homeId: string;
}

@Injectable()
export class ListHomeEnergyTariffsUseCase {
  constructor(private readonly tariffRepository: HomeEnergyTariffRepository) {}

  async execute(
    input: ListHomeEnergyTariffsInput,
  ): Promise<HomeEnergyTariffListResponse> {
    try {
      const tariffs = await this.tariffRepository.findAllByHome(
        input.userId,
        input.homeId,
      );

      return {
        homeId: input.homeId,
        tariffs: tariffs.map(toHomeEnergyTariffResponse),
      };
    } catch (error) {
      throwEnergyHttpError(error);
    }
  }
}
