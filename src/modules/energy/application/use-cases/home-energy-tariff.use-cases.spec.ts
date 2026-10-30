import { ConflictException, ForbiddenException } from '@nestjs/common';

import { HomeEnergyTariff } from '../../domain/entities/home-energy-tariff.entity';
import {
  EnergyManageAccessDeniedError,
  EnergyReadAccessDeniedError,
  HomeEnergyTariffAlreadyExistsError,
} from '../../domain/errors/energy.errors';
import { HomeEnergyTariffRepository } from '../../domain/repositories/home-energy-tariff.repository';
import { CreateHomeEnergyTariffUseCase } from './create-home-energy-tariff.use-case';
import { GetCurrentHomeEnergyTariffUseCase } from './get-current-home-energy-tariff.use-case';
import { ListHomeEnergyTariffsUseCase } from './list-home-energy-tariffs.use-case';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOME_ID = '22222222-2222-4222-8222-222222222222';

const tariff = new HomeEnergyTariff({
  id: '33333333-3333-4333-8333-333333333333',
  homeId: HOME_ID,
  unitPriceCopKwh: '950.2500',
  effectiveFrom: '2026-11-01',
  createdAt: new Date('2026-10-29T17:00:00.000Z'),
});

function repositoryMock() {
  const findAllByHome = jest.fn<
    ReturnType<HomeEnergyTariffRepository['findAllByHome']>,
    Parameters<HomeEnergyTariffRepository['findAllByHome']>
  >();
  const findEffectiveAt = jest.fn<
    ReturnType<HomeEnergyTariffRepository['findEffectiveAt']>,
    Parameters<HomeEnergyTariffRepository['findEffectiveAt']>
  >();
  const create = jest.fn<
    ReturnType<HomeEnergyTariffRepository['create']>,
    Parameters<HomeEnergyTariffRepository['create']>
  >();
  const repository: HomeEnergyTariffRepository = {
    findAllByHome,
    findEffectiveAt,
    create,
  };

  return { repository, findAllByHome, findEffectiveAt, create };
}

describe('Casos de uso de tarifas de energía', () => {
  it('lista el historial con decimales como texto', async () => {
    const { repository, findAllByHome } = repositoryMock();
    findAllByHome.mockResolvedValue([tariff]);

    const result = await new ListHomeEnergyTariffsUseCase(repository).execute({
      userId: USER_ID,
      homeId: HOME_ID,
    });

    expect(findAllByHome).toHaveBeenCalledWith(USER_ID, HOME_ID);
    expect(result).toEqual({
      homeId: HOME_ID,
      tariffs: [
        {
          id: tariff.id,
          homeId: HOME_ID,
          unitPriceCopKwh: '950.2500',
          effectiveFrom: '2026-11-01',
          createdAt: '2026-10-29T17:00:00.000Z',
        },
      ],
    });
  });

  it('responde 403 sin datos cuando no hay permiso de lectura', async () => {
    const { repository, findAllByHome } = repositoryMock();
    findAllByHome.mockRejectedValue(new EnergyReadAccessDeniedError());

    await expect(
      new ListHomeEnergyTariffsUseCase(repository).execute({
        userId: USER_ID,
        homeId: HOME_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('consulta la tarifa vigente para la fecha indicada y devuelve null si no hay', async () => {
    const { repository, findEffectiveAt } = repositoryMock();
    findEffectiveAt.mockResolvedValue(null);

    const result = await new GetCurrentHomeEnergyTariffUseCase(
      repository,
    ).execute({
      userId: USER_ID,
      homeId: HOME_ID,
      at: '2026-10-15',
    });

    expect(findEffectiveAt).toHaveBeenCalledWith(
      USER_ID,
      HOME_ID,
      '2026-10-15',
    );
    expect(result).toEqual({ homeId: HOME_ID, at: '2026-10-15', tariff: null });
  });

  it('usa la fecha de hoy en Bogotá cuando no se envía at', async () => {
    const { repository, findEffectiveAt } = repositoryMock();
    findEffectiveAt.mockResolvedValue(tariff);

    const result = await new GetCurrentHomeEnergyTariffUseCase(
      repository,
    ).execute({
      userId: USER_ID,
      homeId: HOME_ID,
    });

    expect(result.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.tariff?.unitPriceCopKwh).toBe('950.2500');
  });

  it('registra una tarifa nueva', async () => {
    const { repository, create } = repositoryMock();
    create.mockResolvedValue(tariff);

    const result = await new CreateHomeEnergyTariffUseCase(repository).execute({
      userId: USER_ID,
      homeId: HOME_ID,
      unitPriceCopKwh: '950.2500',
      effectiveFrom: '2026-11-01',
    });

    expect(create).toHaveBeenCalledWith(USER_ID, {
      homeId: HOME_ID,
      unitPriceCopKwh: '950.2500',
      effectiveFrom: '2026-11-01',
    });
    expect(result.id).toBe(tariff.id);
  });

  it('responde 409 si ya existe una tarifa con esa vigencia', async () => {
    const { repository, create } = repositoryMock();
    create.mockRejectedValue(new HomeEnergyTariffAlreadyExistsError());

    await expect(
      new CreateHomeEnergyTariffUseCase(repository).execute({
        userId: USER_ID,
        homeId: HOME_ID,
        unitPriceCopKwh: '950.2500',
        effectiveFrom: '2026-11-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('responde 403 si quien registra no es OWNER de un hogar activo', async () => {
    const { repository, create } = repositoryMock();
    create.mockRejectedValue(new EnergyManageAccessDeniedError());

    await expect(
      new CreateHomeEnergyTariffUseCase(repository).execute({
        userId: USER_ID,
        homeId: HOME_ID,
        unitPriceCopKwh: '950.2500',
        effectiveFrom: '2026-11-01',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
