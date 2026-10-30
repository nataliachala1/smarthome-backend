import { ForbiddenException } from '@nestjs/common';

import { EnergyReadAccessDeniedError } from '../../domain/errors/energy.errors';
import { HomeEnergySummaryRepository } from '../../domain/repositories/home-energy-summary.repository';
import { GetHomeEnergySummaryUseCase } from './get-home-energy-summary.use-case';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOME_ID = '22222222-2222-4222-8222-222222222222';

function repositoryMock() {
  const getMonthFacts = jest.fn<
    ReturnType<HomeEnergySummaryRepository['getMonthFacts']>,
    Parameters<HomeEnergySummaryRepository['getMonthFacts']>
  >();
  const repository: HomeEnergySummaryRepository = { getMonthFacts };

  return { repository, getMonthFacts };
}

describe('GetHomeEnergySummaryUseCase', () => {
  it('pide los datos del mes con el rango de Bogotá y arma el resumen', async () => {
    const { repository, getMonthFacts } = repositoryMock();
    getMonthFacts.mockResolvedValue({
      readingsCount: 4,
      unpricedReadings: 0,
      totalKwh: '6.500000',
      pricedCostCop: '7201.7500000000',
      monthlyBudgetCop: '10000.00',
      targetKwh: '5.000000',
    });

    const result = await new GetHomeEnergySummaryUseCase(repository).execute({
      userId: USER_ID,
      homeId: HOME_ID,
      month: '2026-11',
    });

    expect(getMonthFacts).toHaveBeenCalledWith(USER_ID, {
      homeId: HOME_ID,
      month: '2026-11',
      from: new Date('2026-11-01T05:00:00.000Z'),
      to: new Date('2026-12-01T05:00:00.000Z'),
    });
    expect(result).toMatchObject({
      homeId: HOME_ID,
      month: '2026-11',
      timezone: 'America/Bogota',
      from: '2026-11-01T05:00:00.000Z',
      to: '2026-12-01T05:00:00.000Z',
      estimatedCostCop: '7201.75',
      budgetUsagePercent: '72.02',
      targetUsagePercent: '130.00',
    });
  });

  it('GUEST o sin permiso de detalle: 403 sin datos económicos', async () => {
    const { repository, getMonthFacts } = repositoryMock();
    getMonthFacts.mockRejectedValue(new EnergyReadAccessDeniedError());

    await expect(
      new GetHomeEnergySummaryUseCase(repository).execute({
        userId: USER_ID,
        homeId: HOME_ID,
        month: '2026-11',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
