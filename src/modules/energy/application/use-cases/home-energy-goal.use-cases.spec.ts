import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import { HomeEnergyGoal } from '../../domain/entities/home-energy-goal.entity';
import {
  EnergyGoalConcurrentWriteError,
  EnergyManageAccessDeniedError,
  EnergyReadAccessDeniedError,
} from '../../domain/errors/energy.errors';
import { HomeEnergyGoalRepository } from '../../domain/repositories/home-energy-goal.repository';
import { GetHomeEnergyGoalUseCase } from './get-home-energy-goal.use-case';
import { UpsertHomeEnergyGoalUseCase } from './upsert-home-energy-goal.use-case';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOME_ID = '22222222-2222-4222-8222-222222222222';

const goal = new HomeEnergyGoal({
  id: '44444444-4444-4444-8444-444444444444',
  homeId: HOME_ID,
  month: '2026-11',
  monthlyBudgetCop: null,
  targetKwh: '125.000000',
  createdAt: new Date('2026-10-30T17:00:00.000Z'),
  updatedAt: new Date('2026-10-30T18:00:00.000Z'),
});

function repositoryMock() {
  const findByMonth = jest.fn<
    ReturnType<HomeEnergyGoalRepository['findByMonth']>,
    Parameters<HomeEnergyGoalRepository['findByMonth']>
  >();
  const upsert = jest.fn<
    ReturnType<HomeEnergyGoalRepository['upsert']>,
    Parameters<HomeEnergyGoalRepository['upsert']>
  >();
  const repository: HomeEnergyGoalRepository = { findByMonth, upsert };

  return { repository, findByMonth, upsert };
}

describe('Monthly budget and target use cases', () => {
  it('reads the given month and returns the goal with decimals as text', async () => {
    const { repository, findByMonth } = repositoryMock();
    findByMonth.mockResolvedValue(goal);

    const result = await new GetHomeEnergyGoalUseCase(repository).execute({
      userId: USER_ID,
      homeId: HOME_ID,
      month: '2026-11',
    });

    expect(findByMonth).toHaveBeenCalledWith(USER_ID, HOME_ID, '2026-11');
    expect(result).toEqual({
      homeId: HOME_ID,
      month: '2026-11',
      goal: {
        id: goal.id,
        homeId: HOME_ID,
        month: '2026-11',
        monthlyBudgetCop: null,
        targetKwh: '125.000000',
        createdAt: '2026-10-30T17:00:00.000Z',
        updatedAt: '2026-10-30T18:00:00.000Z',
      },
    });
  });

  it('returns goal null when the month is not configured and uses the current month by default', async () => {
    const { repository, findByMonth } = repositoryMock();
    findByMonth.mockResolvedValue(null);

    const result = await new GetHomeEnergyGoalUseCase(repository).execute({
      userId: USER_ID,
      homeId: HOME_ID,
    });

    expect(result.month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    expect(result.goal).toBeNull();
  });

  it('returns 403 to someone who cannot read (GUEST or no view_consumption)', async () => {
    const { repository, findByMonth } = repositoryMock();
    findByMonth.mockRejectedValue(new EnergyReadAccessDeniedError());

    await expect(
      new GetHomeEnergyGoalUseCase(repository).execute({
        userId: USER_ID,
        homeId: HOME_ID,
        month: '2026-11',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates or replaces the month goal', async () => {
    const { repository, upsert } = repositoryMock();
    upsert.mockResolvedValue(goal);

    const result = await new UpsertHomeEnergyGoalUseCase(repository).execute({
      userId: USER_ID,
      homeId: HOME_ID,
      month: '2026-11',
      monthlyBudgetCop: null,
      targetKwh: '125',
    });

    expect(upsert).toHaveBeenCalledWith(USER_ID, {
      homeId: HOME_ID,
      month: '2026-11',
      monthlyBudgetCop: null,
      targetKwh: '125',
    });
    expect(result.targetKwh).toBe('125.000000');
  });

  it('returns 400 without writing when budget and target are both null', async () => {
    const { repository, upsert } = repositoryMock();

    await expect(
      new UpsertHomeEnergyGoalUseCase(repository).execute({
        userId: USER_ID,
        homeId: HOME_ID,
        month: '2026-11',
        monthlyBudgetCop: null,
        targetKwh: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns 403 when the writer is not the OWNER of an active home', async () => {
    const { repository, upsert } = repositoryMock();
    upsert.mockRejectedValue(new EnergyManageAccessDeniedError());

    await expect(
      new UpsertHomeEnergyGoalUseCase(repository).execute({
        userId: USER_ID,
        homeId: HOME_ID,
        month: '2026-11',
        monthlyBudgetCop: '1.00',
        targetKwh: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 409 on a concurrent write of the same month', async () => {
    const { repository, upsert } = repositoryMock();
    upsert.mockRejectedValue(new EnergyGoalConcurrentWriteError());

    await expect(
      new UpsertHomeEnergyGoalUseCase(repository).execute({
        userId: USER_ID,
        homeId: HOME_ID,
        month: '2026-11',
        monthlyBudgetCop: '1.00',
        targetKwh: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
