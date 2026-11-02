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
 * Registra una nueva vigencia de tarifa. Las tarifas históricas no se editan:
 * un cambio de precio siempre es un INSERT con otra fecha de vigencia.
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
