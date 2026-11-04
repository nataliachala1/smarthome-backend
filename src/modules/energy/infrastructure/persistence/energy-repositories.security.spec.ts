jest.mock(
  '../../../../infrastructure/database/prisma/prisma-rls.service',
  () => ({
    PrismaRlsService: class PrismaRlsService {},
  }),
);

import type { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import {
  EnergyGoalConcurrentWriteError,
  EnergyManageAccessDeniedError,
  EnergyReadAccessDeniedError,
  HomeEnergyTariffAlreadyExistsError,
} from '../../domain/errors/energy.errors';
import { PrismaHomeEnergyGoalRepository } from './prisma-home-energy-goal.repository';
import { PrismaHomeEnergyTariffRepository } from './prisma-home-energy-tariff.repository';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOME_ID = '22222222-2222-4222-8222-222222222222';

const READ_FN = 'consumption.fn_can_read_detail';
const MANAGE_FN = 'homes.fn_can_manage_home';

function decimal(value: number) {
  return { toFixed: (digits: number) => value.toFixed(digits) };
}

const tariffRow = {
  id_home_energy_tariff: '33333333-3333-4333-8333-333333333333',
  id_home: HOME_ID,
  unit_price_cop_kwh: decimal(950.25),
  effective_from: new Date('2026-11-01T00:00:00.000Z'),
  created_at: new Date('2026-10-30T17:00:00.000Z'),
};

const goalRow = {
  id_home_energy_goal: '44444444-4444-4444-8444-444444444444',
  id_home: HOME_ID,
  month_start: new Date('2026-11-01T00:00:00.000Z'),
  monthly_budget_cop: null,
  target_kwh: decimal(125),
  created_at: new Date('2026-10-30T17:00:00.000Z'),
  updated_at: new Date('2026-10-30T17:00:00.000Z'),
};

/**
 * Simula PrismaRlsService y la transacción. Registra en orden cada consulta
 * de autorización y cada acceso a tablas para verificar que la autorización
 * ocurre primero y dentro de la misma transacción.
 */
function fakeDatabase(allowed: boolean) {
  const events: string[] = [];
  const authorizationValues: unknown[] = [];

  const queryRaw = jest.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('$');
      events.push(
        sql.includes(READ_FN)
          ? 'read-check'
          : sql.includes(MANAGE_FN)
            ? 'manage-check'
            : 'other-query',
      );
      authorizationValues.push(...values);
      return Promise.resolve([{ allowed }]);
    },
  );
  const table = (name: string, result: unknown) =>
    jest.fn(() => {
      events.push(name);
      return Promise.resolve(result);
    });

  const tx = {
    $queryRaw: queryRaw,
    home_energy_tariff: {
      findMany: table('tariff.findMany', [tariffRow]),
      findFirst: table('tariff.findFirst', tariffRow),
      create: table('tariff.create', tariffRow),
    },
    home_energy_goal: {
      findUnique: table('goal.findUnique', goalRow),
      upsert: table('goal.upsert', goalRow),
    },
  };

  const withUserContext = jest.fn(
    (userId: string, operation: (client: typeof tx) => Promise<unknown>) => {
      events.push('context:' + userId);
      return operation(tx);
    },
  );

  const rls = { withUserContext } as unknown as PrismaRlsService;

  return { rls, tx, events, authorizationValues, withUserContext };
}

function failingDatabase(error: Error) {
  const withUserContext = jest.fn(() => Promise.reject(error));
  return { withUserContext } as unknown as PrismaRlsService;
}

const postgresPermissionDenied = Object.assign(new Error('permission denied'), {
  meta: { driverAdapterError: { cause: { originalCode: '42501' } } },
});
const uniqueViolation = Object.assign(new Error('unique violation'), {
  code: 'P2002',
});

describe('Seguridad del repositorio de tarifas', () => {
  it('lectura: usa el contexto RLS del usuario y valida fn_can_read_detail antes de consultar', async () => {
    const db = fakeDatabase(true);
    const repository = new PrismaHomeEnergyTariffRepository(db.rls);

    await repository.findAllByHome(USER_ID, HOME_ID);
    await repository.findEffectiveAt(USER_ID, HOME_ID, '2026-11-15');

    expect(db.withUserContext).toHaveBeenCalledTimes(2);
    expect(db.events).toEqual([
      'context:' + USER_ID,
      'read-check',
      'tariff.findMany',
      'context:' + USER_ID,
      'read-check',
      'tariff.findFirst',
    ]);
    expect(db.authorizationValues).toEqual([HOME_ID, HOME_ID]);
  });

  it('lectura denegada (GUEST, sin membresía o sin view_consumption): 403 sin tocar la tabla', async () => {
    const db = fakeDatabase(false);
    const repository = new PrismaHomeEnergyTariffRepository(db.rls);

    await expect(
      repository.findAllByHome(USER_ID, HOME_ID),
    ).rejects.toBeInstanceOf(EnergyReadAccessDeniedError);
    await expect(
      repository.findEffectiveAt(USER_ID, HOME_ID, '2026-11-15'),
    ).rejects.toBeInstanceOf(EnergyReadAccessDeniedError);

    expect(db.tx.home_energy_tariff.findMany).not.toHaveBeenCalled();
    expect(db.tx.home_energy_tariff.findFirst).not.toHaveBeenCalled();
  });

  it('escritura: valida fn_can_manage_home (solo OWNER) antes de insertar', async () => {
    const db = fakeDatabase(true);
    const repository = new PrismaHomeEnergyTariffRepository(db.rls);

    await repository.create(USER_ID, {
      homeId: HOME_ID,
      unitPriceCopKwh: '950.25',
      effectiveFrom: '2026-11-01',
    });

    expect(db.events).toEqual([
      'context:' + USER_ID,
      'manage-check',
      'tariff.create',
    ]);
  });

  it('escritura denegada (MEMBER o GUEST): 403 sin insertar', async () => {
    const db = fakeDatabase(false);
    const repository = new PrismaHomeEnergyTariffRepository(db.rls);

    await expect(
      repository.create(USER_ID, {
        homeId: HOME_ID,
        unitPriceCopKwh: '950.25',
        effectiveFrom: '2026-11-01',
      }),
    ).rejects.toBeInstanceOf(EnergyManageAccessDeniedError);
    expect(db.tx.home_energy_tariff.create).not.toHaveBeenCalled();
  });

  it('42501 (privilegio o política RLS) en LECTURA se reporta como lectura denegada, no como escritura', async () => {
    const repository = new PrismaHomeEnergyTariffRepository(
      failingDatabase(postgresPermissionDenied),
    );

    await expect(
      repository.findAllByHome(USER_ID, HOME_ID),
    ).rejects.toBeInstanceOf(EnergyReadAccessDeniedError);
    await expect(
      repository.findEffectiveAt(USER_ID, HOME_ID, '2026-11-15'),
    ).rejects.toBeInstanceOf(EnergyReadAccessDeniedError);
  });

  it('42501 en ESCRITURA se reporta como gestión denegada; P2002 como duplicado', async () => {
    await expect(
      new PrismaHomeEnergyTariffRepository(
        failingDatabase(postgresPermissionDenied),
      ).create(USER_ID, {
        homeId: HOME_ID,
        unitPriceCopKwh: '950.25',
        effectiveFrom: '2026-11-01',
      }),
    ).rejects.toBeInstanceOf(EnergyManageAccessDeniedError);

    await expect(
      new PrismaHomeEnergyTariffRepository(
        failingDatabase(uniqueViolation),
      ).create(USER_ID, {
        homeId: HOME_ID,
        unitPriceCopKwh: '950.25',
        effectiveFrom: '2026-11-01',
      }),
    ).rejects.toBeInstanceOf(HomeEnergyTariffAlreadyExistsError);
  });
});

describe('Seguridad del repositorio de objetivos mensuales', () => {
  it('lectura: valida fn_can_read_detail antes de consultar el mes', async () => {
    const db = fakeDatabase(true);
    const repository = new PrismaHomeEnergyGoalRepository(db.rls);

    const goal = await repository.findByMonth(USER_ID, HOME_ID, '2026-11');

    expect(goal?.targetKwh).toBe('125.000000');
    expect(db.events).toEqual([
      'context:' + USER_ID,
      'read-check',
      'goal.findUnique',
    ]);
  });

  it('lectura denegada: 403 sin consultar la tabla', async () => {
    const db = fakeDatabase(false);
    const repository = new PrismaHomeEnergyGoalRepository(db.rls);

    await expect(
      repository.findByMonth(USER_ID, HOME_ID, '2026-11'),
    ).rejects.toBeInstanceOf(EnergyReadAccessDeniedError);
    expect(db.tx.home_energy_goal.findUnique).not.toHaveBeenCalled();
  });

  it('escritura: valida fn_can_manage_home y solo actualiza presupuesto y meta', async () => {
    const db = fakeDatabase(true);
    const repository = new PrismaHomeEnergyGoalRepository(db.rls);

    await repository.upsert(USER_ID, {
      homeId: HOME_ID,
      month: '2026-11',
      monthlyBudgetCop: null,
      targetKwh: '125',
    });

    expect(db.events).toEqual([
      'context:' + USER_ID,
      'manage-check',
      'goal.upsert',
    ]);
    expect(db.tx.home_energy_goal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { monthly_budget_cop: null, target_kwh: '125' },
      }),
    );
  });

  it('escritura denegada (MEMBER o GUEST): 403 sin escribir', async () => {
    const db = fakeDatabase(false);
    const repository = new PrismaHomeEnergyGoalRepository(db.rls);

    await expect(
      repository.upsert(USER_ID, {
        homeId: HOME_ID,
        month: '2026-11',
        monthlyBudgetCop: '1.00',
        targetKwh: null,
      }),
    ).rejects.toBeInstanceOf(EnergyManageAccessDeniedError);
    expect(db.tx.home_energy_goal.upsert).not.toHaveBeenCalled();
  });

  it('42501 en LECTURA del mes se reporta como lectura denegada', async () => {
    await expect(
      new PrismaHomeEnergyGoalRepository(
        failingDatabase(postgresPermissionDenied),
      ).findByMonth(USER_ID, HOME_ID, '2026-11'),
    ).rejects.toBeInstanceOf(EnergyReadAccessDeniedError);
  });

  it('42501 en ESCRITURA se reporta como gestión denegada; P2002 como escritura simultánea', async () => {
    await expect(
      new PrismaHomeEnergyGoalRepository(
        failingDatabase(postgresPermissionDenied),
      ).upsert(USER_ID, {
        homeId: HOME_ID,
        month: '2026-11',
        monthlyBudgetCop: '1.00',
        targetKwh: null,
      }),
    ).rejects.toBeInstanceOf(EnergyManageAccessDeniedError);

    await expect(
      new PrismaHomeEnergyGoalRepository(
        failingDatabase(uniqueViolation),
      ).upsert(USER_ID, {
        homeId: HOME_ID,
        month: '2026-11',
        monthlyBudgetCop: '1.00',
        targetKwh: null,
      }),
    ).rejects.toBeInstanceOf(EnergyGoalConcurrentWriteError);
  });
});
