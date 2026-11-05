jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CreateHomeEnergyTariffUseCase } from '../../application/use-cases/create-home-energy-tariff.use-case';
import { GetCurrentHomeEnergyTariffUseCase } from '../../application/use-cases/get-current-home-energy-tariff.use-case';
import { GetHomeEnergyGoalUseCase } from '../../application/use-cases/get-home-energy-goal.use-case';
import { GetHomeEnergySummaryUseCase } from '../../application/use-cases/get-home-energy-summary.use-case';
import { ListHomeEnergyTariffsUseCase } from '../../application/use-cases/list-home-energy-tariffs.use-case';
import { UpsertHomeEnergyGoalUseCase } from '../../application/use-cases/upsert-home-energy-goal.use-case';
import { HomeEnergyGoal } from '../../domain/entities/home-energy-goal.entity';
import { HomeEnergyTariff } from '../../domain/entities/home-energy-tariff.entity';
import {
  EnergyGoalConcurrentWriteError,
  HomeEnergyTariffAlreadyExistsError,
} from '../../domain/errors/energy.errors';
import { HomeEnergyGoalRepository } from '../../domain/repositories/home-energy-goal.repository';
import { HomeEnergySummaryRepository } from '../../domain/repositories/home-energy-summary.repository';
import { HomeEnergyTariffRepository } from '../../domain/repositories/home-energy-tariff.repository';
import { HomeEnergyGoalsController } from './home-energy-goals.controller';
import { HomeEnergySummaryController } from './home-energy-summary.controller';
import { HomeEnergyTariffsController } from './home-energy-tariffs.controller';

const HOME_ID = '22222222-2222-4222-8222-222222222222';
const BASE = '/api/v1/homes/' + HOME_ID + '/energy';

const tariff = new HomeEnergyTariff({
  id: '33333333-3333-4333-8333-333333333333',
  homeId: HOME_ID,
  unitPriceCopKwh: '950.2500',
  effectiveFrom: '2026-11-01',
  createdAt: new Date('2026-10-30T17:00:00.000Z'),
});

const goal = new HomeEnergyGoal({
  id: '44444444-4444-4444-8444-444444444444',
  homeId: HOME_ID,
  month: '2026-11',
  monthlyBudgetCop: '120000.00',
  targetKwh: null,
  createdAt: new Date('2026-10-30T17:00:00.000Z'),
  updatedAt: new Date('2026-10-30T17:00:00.000Z'),
});

const createTariff = jest.fn<
  ReturnType<HomeEnergyTariffRepository['create']>,
  Parameters<HomeEnergyTariffRepository['create']>
>();
const upsertGoal = jest.fn<
  ReturnType<HomeEnergyGoalRepository['upsert']>,
  Parameters<HomeEnergyGoalRepository['upsert']>
>();
const getMonthFacts = jest.fn<
  ReturnType<HomeEnergySummaryRepository['getMonthFacts']>,
  Parameters<HomeEnergySummaryRepository['getMonthFacts']>
>();

const tariffRepository: HomeEnergyTariffRepository = {
  findAllByHome: () => Promise.resolve([tariff]),
  findEffectiveAt: () => Promise.resolve(tariff),
  create: createTariff,
};
const goalRepository: HomeEnergyGoalRepository = {
  findByMonth: () => Promise.resolve(goal),
  upsert: upsertGoal,
};
const summaryRepository: HomeEnergySummaryRepository = {
  getMonthFacts,
};

describe('Validaciones HTTP de la API de energía', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        HomeEnergyTariffsController,
        HomeEnergyGoalsController,
        HomeEnergySummaryController,
      ],
      providers: [
        ListHomeEnergyTariffsUseCase,
        GetCurrentHomeEnergyTariffUseCase,
        CreateHomeEnergyTariffUseCase,
        GetHomeEnergyGoalUseCase,
        UpsertHomeEnergyGoalUseCase,
        GetHomeEnergySummaryUseCase,
        { provide: HomeEnergyTariffRepository, useValue: tariffRepository },
        { provide: HomeEnergyGoalRepository, useValue: goalRepository },
        { provide: HomeEnergySummaryRepository, useValue: summaryRepository },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<{ user: { userId: string } }>().user = {
            userId: '11111111-1111-4111-8111-111111111111',
          };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Misma configuración global que src/main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    createTariff.mockReset().mockResolvedValue(tariff);
    upsertGoal.mockReset().mockResolvedValue(goal);
    getMonthFacts.mockReset().mockResolvedValue({
      readingsCount: 0,
      unpricedReadings: 0,
      totalKwh: '0',
      pricedCostCop: '0',
      monthlyBudgetCop: null,
      targetKwh: null,
    });
  });

  const server = () => app.getHttpServer();

  describe('UUID del hogar', () => {
    it.each([
      ['GET', '/api/v1/homes/no-es-uuid/energy/tariffs'],
      ['GET', '/api/v1/homes/no-es-uuid/energy/tariffs/current'],
      ['GET', '/api/v1/homes/no-es-uuid/energy/goals'],
      ['GET', '/api/v1/homes/no-es-uuid/energy/summary'],
    ])('%s %s responde 400', async (_method, url) => {
      await request(server()).get(url).expect(400);
    });

    it('POST y PUT con UUID inválido responden 400 sin escribir', async () => {
      await request(server())
        .post('/api/v1/homes/123/energy/tariffs')
        .send({ unitPriceCopKwh: '1', effectiveFrom: '2026-11-01' })
        .expect(400);
      await request(server())
        .put('/api/v1/homes/123/energy/goals/2026-11')
        .send({ monthlyBudgetCop: '1', targetKwh: null })
        .expect(400);

      expect(createTariff).not.toHaveBeenCalled();
      expect(upsertGoal).not.toHaveBeenCalled();
    });
  });

  describe('Fechas (YYYY-MM-DD reales, año 2000–2099)', () => {
    it.each([
      ['2026-02-29'],
      ['2026-02-30'],
      ['2026-13-01'],
      ['2026-11-1'],
      ['01/11/2026'],
      ['2026-11-01T00:00:00Z'],
      ['0000-01-01'],
      ['2100-01-01'],
    ])('rechaza effectiveFrom %p', async (effectiveFrom) => {
      await request(server())
        .post(BASE + '/tariffs')
        .send({ unitPriceCopKwh: '950.25', effectiveFrom })
        .expect(400);
      expect(createTariff).not.toHaveBeenCalled();
    });

    it.each([['2026-02-30'], ['hoy'], ['0000-01-01']])(
      'rechaza la consulta de tarifa vigente con at=%p',
      async (at) => {
        await request(server())
          .get(BASE + '/tariffs/current')
          .query({ at })
          .expect(400);
      },
    );

    it('acepta fechas válidas, incluido el 29 de febrero bisiesto', async () => {
      await request(server())
        .post(BASE + '/tariffs')
        .send({ unitPriceCopKwh: '950.25', effectiveFrom: '2028-02-29' })
        .expect(201);
    });
  });

  describe('Meses (YYYY-MM, año 2000–2099, mes 01..12)', () => {
    it.each([['2026-13'], ['2026-00'], ['2026-1'], ['0000-01'], ['9999-12']])(
      'GET goals y GET summary rechazan month=%p (400, nunca 500)',
      async (month) => {
        await request(server())
          .get(BASE + '/goals')
          .query({ month })
          .expect(400);
        await request(server())
          .get(BASE + '/summary')
          .query({ month })
          .expect(400);
      },
    );

    it.each([['2026-13'], ['0000-01'], ['2026-11-01'], ['noviembre']])(
      'PUT goals rechaza el mes de la ruta %p',
      async (month) => {
        await request(server())
          .put(BASE + '/goals/' + month)
          .send({ monthlyBudgetCop: '1', targetKwh: null })
          .expect(400);
        expect(upsertGoal).not.toHaveBeenCalled();
      },
    );

    it('el mes 2099-12 es válido y su rango termina el 1 de enero de 2100', async () => {
      const response = await request(server())
        .get(BASE + '/summary')
        .query({ month: '2099-12' })
        .expect(200);

      expect(response.body).toMatchObject({
        month: '2099-12',
        to: '2100-01-01T05:00:00.000Z',
      });
    });
  });

  describe('Precios y decimales positivos', () => {
    it.each([
      ['0'],
      ['0.0000'],
      ['-1'],
      ['1.12345'],
      ['12345678901'],
      ['1e3'],
      ['950,25'],
      [' 1'],
      ['+1'],
      ['1.'],
      ['007'],
      [950.25],
    ])('rechaza el precio %p', async (unitPriceCopKwh) => {
      await request(server())
        .post(BASE + '/tariffs')
        .send({ unitPriceCopKwh, effectiveFrom: '2026-11-01' })
        .expect(400);
      expect(createTariff).not.toHaveBeenCalled();
    });

    it.each([
      [{ monthlyBudgetCop: '0', targetKwh: null }],
      [{ monthlyBudgetCop: '1.123', targetKwh: null }],
      [{ monthlyBudgetCop: 120000, targetKwh: null }],
      [{ monthlyBudgetCop: null, targetKwh: '-5' }],
      [{ monthlyBudgetCop: null, targetKwh: '1.1234567' }],
      [{ monthlyBudgetCop: '', targetKwh: '1' }],
    ])('rechaza presupuesto o meta inválidos %p', async (body) => {
      await request(server())
        .put(BASE + '/goals/2026-11')
        .send(body)
        .expect(400);
      expect(upsertGoal).not.toHaveBeenCalled();
    });
  });

  describe('Regla presupuesto/meta y cuerpo del PUT', () => {
    it('presupuesto y meta ambos null: 400 ENERGY_GOAL_VALUE_REQUIRED sin escribir', async () => {
      const response = await request(server())
        .put(BASE + '/goals/2026-11')
        .send({ monthlyBudgetCop: null, targetKwh: null })
        .expect(400);

      expect(response.body).toMatchObject({
        code: 'ENERGY_GOAL_VALUE_REQUIRED',
      });
      expect(upsertGoal).not.toHaveBeenCalled();
    });

    it.each([
      [{ targetKwh: '125' }],
      [{ monthlyBudgetCop: '120000' }],
      [{}],
      [[]],
      [{ monthlyBudgetCop: '1', targetKwh: null, id_home: HOME_ID }],
    ])('rechaza cuerpo incompleto o con campos extra %p', async (body) => {
      await request(server())
        .put(BASE + '/goals/2026-11')
        .send(body)
        .expect(400);
      expect(upsertGoal).not.toHaveBeenCalled();
    });

    it.each([
      [{ monthlyBudgetCop: '120000.00', targetKwh: null }],
      [{ monthlyBudgetCop: null, targetKwh: '125' }],
      [{ monthlyBudgetCop: '120000', targetKwh: '125.5' }],
    ])('acepta solo presupuesto, solo meta o ambos %p', async (body) => {
      await request(server())
        .put(BASE + '/goals/2026-11')
        .send(body)
        .expect(200);
    });
  });

  describe('Duplicados', () => {
    it('tarifa con la misma fecha de vigencia: 409 ENERGY_TARIFF_DUPLICATE', async () => {
      createTariff.mockRejectedValue(new HomeEnergyTariffAlreadyExistsError());

      const response = await request(server())
        .post(BASE + '/tariffs')
        .send({ unitPriceCopKwh: '950.25', effectiveFrom: '2026-11-01' })
        .expect(409);

      expect(response.body).toMatchObject({ code: 'ENERGY_TARIFF_DUPLICATE' });
      expect(JSON.stringify(response.body)).not.toMatch(/select|insert|P2002/i);
    });

    it('meta del mismo mes escrita a la vez: 409 ENERGY_GOAL_CONCURRENT_WRITE', async () => {
      upsertGoal.mockRejectedValue(new EnergyGoalConcurrentWriteError());

      const response = await request(server())
        .put(BASE + '/goals/2026-11')
        .send({ monthlyBudgetCop: '1', targetKwh: null })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'ENERGY_GOAL_CONCURRENT_WRITE',
      });
    });

    it('PUT repetido del mismo mes es idempotente (mismo resultado, sin error)', async () => {
      const body = { monthlyBudgetCop: '120000.00', targetKwh: null };

      const first = await request(server())
        .put(BASE + '/goals/2026-11')
        .send(body)
        .expect(200);
      const second = await request(server())
        .put(BASE + '/goals/2026-11')
        .send(body)
        .expect(200);

      expect(second.body).toEqual(first.body);
    });
  });

  it('rechaza parámetros de consulta desconocidos', async () => {
    await request(server())
      .get(BASE + '/summary')
      .query({ month: '2026-11', foo: '1' })
      .expect(400);
  });
});
