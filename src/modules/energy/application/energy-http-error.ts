import { ConflictException, ForbiddenException } from '@nestjs/common';

import {
  EnergyManageAccessDeniedError,
  EnergyReadAccessDeniedError,
  HomeEnergyTariffAlreadyExistsError,
} from '../domain/errors/energy.errors';

/** Traduce errores de dominio de energía a respuestas HTTP sin filtrar detalles SQL. */
export function throwEnergyHttpError(error: unknown): never {
  if (error instanceof EnergyReadAccessDeniedError) {
    throw new ForbiddenException({
      code: 'ENERGY_READ_FORBIDDEN',
      message: error.message,
    });
  }

  if (error instanceof EnergyManageAccessDeniedError) {
    throw new ForbiddenException({
      code: 'ENERGY_MANAGE_FORBIDDEN',
      message: error.message,
    });
  }

  if (error instanceof HomeEnergyTariffAlreadyExistsError) {
    throw new ConflictException({
      code: 'ENERGY_TARIFF_DUPLICATE',
      message: error.message,
    });
  }

  throw error;
}
