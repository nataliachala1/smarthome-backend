import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';

import {
  EnergyGoalConcurrentWriteError,
  EnergyGoalRequiresValueError,
  EnergyManageAccessDeniedError,
  EnergyReadAccessDeniedError,
  HomeEnergyTariffAlreadyExistsError,
} from '../domain/errors/energy.errors';
import { throwEnergyHttpError } from './energy-http-error';

function translate(error: unknown): HttpException {
  try {
    throwEnergyHttpError(error);
  } catch (translated) {
    return translated as HttpException;
  }
  throw new Error('throwEnergyHttpError siempre debe lanzar');
}

describe('throwEnergyHttpError', () => {
  it.each([
    [
      new EnergyReadAccessDeniedError(),
      ForbiddenException,
      403,
      'ENERGY_READ_FORBIDDEN',
    ],
    [
      new EnergyManageAccessDeniedError(),
      ForbiddenException,
      403,
      'ENERGY_MANAGE_FORBIDDEN',
    ],
    [
      new HomeEnergyTariffAlreadyExistsError(),
      ConflictException,
      409,
      'ENERGY_TARIFF_DUPLICATE',
    ],
    [
      new EnergyGoalConcurrentWriteError(),
      ConflictException,
      409,
      'ENERGY_GOAL_CONCURRENT_WRITE',
    ],
    [
      new EnergyGoalRequiresValueError(),
      BadRequestException,
      400,
      'ENERGY_GOAL_VALUE_REQUIRED',
    ],
  ])(
    'traduce %p a HTTP con su code exacto',
    (domainError, exceptionType, status, code) => {
      const translated = translate(domainError);

      expect(translated).toBeInstanceOf(exceptionType);
      expect(translated.getStatus()).toBe(status);
      expect(translated.getResponse()).toEqual({
        code,
        message: domainError.message,
      });
    },
  );

  it('no transforma errores desconocidos (los maneja el filtro global como 500)', () => {
    const unknown = new Error('fallo inesperado');

    expect(translate(unknown)).toBe(unknown);
  });
});
