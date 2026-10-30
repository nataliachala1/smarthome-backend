jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));
jest.mock(
  '../../../../infrastructure/database/prisma/prisma-rls.service',
  () => ({
    PrismaRlsService: class PrismaRlsService {},
  }),
);

import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CreateHomeEnergyTariffUseCase } from '../../application/use-cases/create-home-energy-tariff.use-case';
import { GetCurrentHomeEnergyTariffUseCase } from '../../application/use-cases/get-current-home-energy-tariff.use-case';
import { GetHomeEnergyGoalUseCase } from '../../application/use-cases/get-home-energy-goal.use-case';
import { GetHomeEnergySummaryUseCase } from '../../application/use-cases/get-home-energy-summary.use-case';
import { ListHomeEnergyTariffsUseCase } from '../../application/use-cases/list-home-energy-tariffs.use-case';
import { UpsertHomeEnergyGoalUseCase } from '../../application/use-cases/upsert-home-energy-goal.use-case';
import { HomeEnergyGoalRepository } from '../../domain/repositories/home-energy-goal.repository';
import { HomeEnergySummaryRepository } from '../../domain/repositories/home-energy-summary.repository';
import { HomeEnergyTariffRepository } from '../../domain/repositories/home-energy-tariff.repository';
import { PrismaHomeEnergyGoalRepository } from '../../infrastructure/persistence/prisma-home-energy-goal.repository';
import { PrismaHomeEnergySummaryRepository } from '../../infrastructure/persistence/prisma-home-energy-summary.repository';
import { PrismaHomeEnergyTariffRepository } from '../../infrastructure/persistence/prisma-home-energy-tariff.repository';
import { HomeEnergyGoalsController } from './home-energy-goals.controller';
import { HomeEnergySummaryController } from './home-energy-summary.controller';
import { HomeEnergyTariffsController } from './home-energy-tariffs.controller';

const HOME_ID = '22222222-2222-4222-8222-222222222222';
const BASE = '/api/v1/homes/' + HOME_ID + '/energy';

/**
 * Rechazo de PostgreSQL por privilegio o política RLS (SQLSTATE 42501), con un
 * mensaje que contiene detalles internos que NUNCA deben llegar al cliente.
 */
const SQL_DETAIL =
  'permission denied for table home_energy_tariff (schema config, role smarthome_runtime_app)';
const permissionDenied = Object.assign(new Error(SQL_DETAIL), {
  code: 'P2010',
  meta: {
    driverAdapterError: {
      cause: { originalCode: '42501', originalMessage: SQL_DETAIL },
    },
  },
});
const LEAK_PATTERN =
  /42501|permission denied|home_energy|config\.|smarthome_runtime_app|SELECT|INSERT|P2010/i;

describe('HTTP: rechazo 42501 de PostgreSQL según lectura o escritura (repositorios Prisma reales)', () => {
  let app: INestApplication<App>;
  const withUserContext = jest.fn(() => Promise.reject(permissionDenied));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        HomeEnergyTariffsController,
        HomeEnergyGoalsController,
        HomeEnergySummaryController,
      ],
      providers: [
        { provide: PrismaRlsService, useValue: { withUserContext } },
        ListHomeEnergyTariffsUseCase,
        GetCurrentHomeEnergyTariffUseCase,
        CreateHomeEnergyTariffUseCase,
        GetHomeEnergyGoalUseCase,
        UpsertHomeEnergyGoalUseCase,
        GetHomeEnergySummaryUseCase,
        {
          provide: HomeEnergyTariffRepository,
          useClass: PrismaHomeEnergyTariffRepository,
        },
        {
          provide: HomeEnergyGoalRepository,
          useClass: PrismaHomeEnergyGoalRepository,
        },
        {
          provide: HomeEnergySummaryRepository,
          useClass: PrismaHomeEnergySummaryRepository,
        },
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

  const server = () => app.getHttpServer();

  it.each([
    ['GET /tariffs', BASE + '/tariffs'],
    ['GET /tariffs/current', BASE + '/tariffs/current?at=2026-11-15'],
    ['GET /goals', BASE + '/goals?month=2026-11'],
    ['GET /summary', BASE + '/summary?month=2026-11'],
  ])(
    '%s responde 403 ENERGY_READ_FORBIDDEN sin detalles SQL',
    async (_name, url) => {
      const response = await request(server()).get(url).expect(403);

      expect(response.body).toEqual({
        code: 'ENERGY_READ_FORBIDDEN',
        message:
          'Sin permisos para consultar la configuración energética de este hogar',
      });
      expect(JSON.stringify(response.body)).not.toMatch(LEAK_PATTERN);
    },
  );

  it('POST /tariffs responde 403 ENERGY_MANAGE_FORBIDDEN sin detalles SQL', async () => {
    const response = await request(server())
      .post(BASE + '/tariffs')
      .send({ unitPriceCopKwh: '950.25', effectiveFrom: '2026-11-01' })
      .expect(403);

    expect(response.body).toEqual({
      code: 'ENERGY_MANAGE_FORBIDDEN',
      message:
        'Solo el propietario de un hogar activo puede modificar la configuración energética',
    });
    expect(JSON.stringify(response.body)).not.toMatch(LEAK_PATTERN);
  });

  it('PUT /goals/:month responde 403 ENERGY_MANAGE_FORBIDDEN sin detalles SQL', async () => {
    const response = await request(server())
      .put(BASE + '/goals/2026-11')
      .send({ monthlyBudgetCop: '120000.00', targetKwh: null })
      .expect(403);

    expect(response.body).toEqual({
      code: 'ENERGY_MANAGE_FORBIDDEN',
      message:
        'Solo el propietario de un hogar activo puede modificar la configuración energética',
    });
    expect(JSON.stringify(response.body)).not.toMatch(LEAK_PATTERN);
  });
});
