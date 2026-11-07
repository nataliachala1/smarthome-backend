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

describe('Energy tariff use cases', () => {
  it('lists the history with decimals as text', async () => {
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

  it('returns 403 without data when there is no read permission', async () => {
    const { repository, findAllByHome } = repositoryMock();
    findAllByHome.mockRejectedValue(new EnergyReadAccessDeniedError());

    await expect(
      new ListHomeEnergyTariffsUseCase(repository).execute({
        userId: USER_ID,
        homeId: HOME_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reads the tariff effective on the given date and returns null when there is none', async () => {
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

  it('uses today\'s date in Bogota when at is not sent', async () => {
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

  it('records a new tariff', async () => {
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

  it('returns 409 when a tariff with that effective date already exists', async () => {
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

  it('returns 403 when the caller is not the OWNER of an active home', async () => {
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
