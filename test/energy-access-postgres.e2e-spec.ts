import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Server } from 'node:http';
import request from 'supertest';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { PrismaRlsService } from '../src/infrastructure/database/prisma/prisma-rls.service';
import { PrismaUserRepository } from '../src/modules/users/infrastructure/persistence/prisma-user.repository';
import { UserRepository } from '../src/modules/users/domain/repositories/user.repository';
import { PrismaRefreshTokenRepository } from '../src/modules/auth/infrastructure/persistence/prisma-refresh-token.repository';
import { RefreshTokenRepository } from '../src/modules/auth/domain/repositories/refresh-token.repository';
import { JwtAuthGuard } from '../src/modules/auth/presentation/http/guards/jwt-auth.guard';
import { SessionRevocationModule } from '../src/security/session-revocation.module';
import { HomeConsumptionController } from '../src/modules/consumption/presentation/controllers/home-consumption.controller';
import { GetHomeConsumptionSummaryUseCase } from '../src/modules/consumption/application/use-cases/get-home-consumption-summary.use-case';
import { ListHomeConsumptionUseCase } from '../src/modules/consumption/application/use-cases/list-home-consumption.use-case';
import { GetHomeDailyConsumptionUseCase } from '../src/modules/consumption/application/use-cases/get-home-daily-consumption.use-case';
import { HomeEnergyTariffsController } from '../src/modules/energy/presentation/controllers/home-energy-tariffs.controller';
import { HomeEnergyGoalsController } from '../src/modules/energy/presentation/controllers/home-energy-goals.controller';
import { HomeEnergySummaryController } from '../src/modules/energy/presentation/controllers/home-energy-summary.controller';
import { ListHomeEnergyTariffsUseCase } from '../src/modules/energy/application/use-cases/list-home-energy-tariffs.use-case';
import { GetCurrentHomeEnergyTariffUseCase } from '../src/modules/energy/application/use-cases/get-current-home-energy-tariff.use-case';
import { CreateHomeEnergyTariffUseCase } from '../src/modules/energy/application/use-cases/create-home-energy-tariff.use-case';
import { GetHomeEnergyGoalUseCase } from '../src/modules/energy/application/use-cases/get-home-energy-goal.use-case';
import { UpsertHomeEnergyGoalUseCase } from '../src/modules/energy/application/use-cases/upsert-home-energy-goal.use-case';
import { GetHomeEnergySummaryUseCase } from '../src/modules/energy/application/use-cases/get-home-energy-summary.use-case';
import { HomeEnergyTariffRepository } from '../src/modules/energy/domain/repositories/home-energy-tariff.repository';
import { HomeEnergyGoalRepository } from '../src/modules/energy/domain/repositories/home-energy-goal.repository';
import { HomeEnergySummaryRepository } from '../src/modules/energy/domain/repositories/home-energy-summary.repository';
import { PrismaHomeEnergyTariffRepository } from '../src/modules/energy/infrastructure/persistence/prisma-home-energy-tariff.repository';
import { PrismaHomeEnergyGoalRepository } from '../src/modules/energy/infrastructure/persistence/prisma-home-energy-goal.repository';
import { PrismaHomeEnergySummaryRepository } from '../src/modules/energy/infrastructure/persistence/prisma-home-energy-summary.repository';

/**
 * SQL034 with real PostgreSQL, active RLS and an unprivileged LOGIN.
 * Uses the disposable database and the official smarthome-database fixture
 * (scripts/consumption-access-fixture.sql). Run it with scripts/test-energy-access.ps1.
 *
 * Fixture: home A (1) with OWNER=1, MEMBER=2, GUEST=3, PENDING MEMBER=5,
 * REVOKED=6, LEFT=7, MEMBER with an inactive account=8, MEMBER=10; previous creator=9.
 * Home B (2) with OWNER=4. Home C (3) DEACTIVATED with OWNER=1 and MEMBER=2.
 * Home A readings in October 2026 (UTC): 0.1 (Oct 10 12:00), 0.2 (Oct 11 12:00),
 * 0.4 (Oct 11 13:00), 0.6 (Oct 12 12:00) = 1.3 kWh.
 */
const databaseUrl = process.env.ENERGY_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const user = (n: number) =>
  '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const home = (n = 1) =>
  '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
const family = (n: number) =>
  '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const energy = (h = 1) => '/api/v1/homes/' + home(h) + '/energy';
const readPaths = (h = 1) => [
  energy(h) + '/tariffs',
  energy(h) + '/tariffs/current?at=2026-10-15',
  energy(h) + '/goals?month=2026-10',
  energy(h) + '/summary?month=2026-10',
];
const ECONOMIC_FIELDS =
  /unitPriceCopKwh|estimatedCostCop|partialCostCop|monthlyBudgetCop|targetKwh|budgetUsagePercent|tariffs|goal"/;

describeDatabase(
  'SQL034 energy: HTTP/JWT + real RLS with an unprivileged LOGIN',
  () => {
    let app: INestApplication<Server>;
    let prisma: PrismaClient;
    let rls: PrismaRlsService;
    let jwt: JwtService;

    beforeAll(async () => {
      const parsed = new URL(databaseUrl!);
      if (
        parsed.hostname !== '127.0.0.1' ||
        parsed.pathname !== '/smarthome_consumption_test' ||
        parsed.username !== 'consumption_app_test'
      ) {
        throw new Error(
          'Only the disposable test database with the non-owner LOGIN is allowed',
        );
      }
      // A single physical connection: the RLS context must be local to each transaction.
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }),
      });
      await prisma.$connect();

      const fixture = await Test.createTestingModule({
        imports: [
          JwtModule.register({ secret: 'synthetic-energy-test-only' }),
          SessionRevocationModule,
        ],
        controllers: [
          HomeEnergyTariffsController,
          HomeEnergyGoalsController,
          HomeEnergySummaryController,
          HomeConsumptionController,
        ],
        providers: [
          { provide: PrismaService, useValue: prisma },
          PrismaRlsService,
          JwtAuthGuard,
          { provide: UserRepository, useClass: PrismaUserRepository },
          {
            provide: RefreshTokenRepository,
            useClass: PrismaRefreshTokenRepository,
          },
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
          GetHomeConsumptionSummaryUseCase,
          ListHomeConsumptionUseCase,
          GetHomeDailyConsumptionUseCase,
        ],
      }).compile();

      app = fixture.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      jwt = app.get(JwtService);
      rls = app.get(PrismaRlsService);
    });

    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
    });

    const token = (n: number) =>
      jwt.sign(
        { sub: user(n), role: 'USER', sv: 0, sid: family(n) },
        { expiresIn: '5m' },
      );
    const http = () => request(app.getHttpServer());
    const get = (path: string, n: number) =>
      http().get(path).auth(token(n), { type: 'bearer' });
    const post = (path: string, n: number, body: object) =>
      http().post(path).auth(token(n), { type: 'bearer' }).send(body);
    const put = (path: string, n: number, body: object) =>
      http().put(path).auth(token(n), { type: 'bearer' }).send(body);

    const memberId = async (n: number, h = 1) => {
      const membership = await rls.withUserContext(user(1), (tx) =>
        tx.home_member.findFirst({
          where: { id_user: user(n), id_home: home(h) },
        }),
      );
      return membership!.id_home_member;
    };

    it('uses a real LOGIN without superuser, BYPASSRLS or membership in elevated or table-owner roles', async () => {
      const [role] = await prisma.$queryRaw<
        { session_user: string; unsafe: boolean }[]
      >`
      SELECT session_user::text,
        EXISTS (SELECT 1 FROM pg_roles r WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole)
          AND pg_has_role(session_user, r.oid, 'MEMBER')) AS unsafe
    `;
      expect(role).toEqual({
        session_user: 'consumption_app_test',
        unsafe: false,
      });
      const [owners] = await prisma.$queryRaw<{ unsafe: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'config' AND c.relname IN ('home_energy_tariff', 'home_energy_goal')
          AND pg_has_role(session_user, c.relowner, 'MEMBER')) AS unsafe
    `;
      expect(owners.unsafe).toBe(false);
    });

    it('T01/T09: OWNER records tariffs; the same effective date returns 409 without duplicating', async () => {
      const first = await post(energy() + '/tariffs', 1, {
        unitPriceCopKwh: '1000',
        effectiveFrom: '2026-10-11',
      }).expect(201);
      expect(first.body).toMatchObject({
        homeId: home(),
        unitPriceCopKwh: '1000.0000',
        effectiveFrom: '2026-10-11',
      });

      const duplicate = await post(energy() + '/tariffs', 1, {
        unitPriceCopKwh: '1500',
        effectiveFrom: '2026-10-11',
      }).expect(409);
      expect(duplicate.body).toMatchObject({ code: 'ENERGY_TARIFF_DUPLICATE' });

      await post(energy() + '/tariffs', 1, {
        unitPriceCopKwh: '2000',
        effectiveFrom: '2026-10-12',
      }).expect(201);

      const history = await get(energy() + '/tariffs', 1).expect(200);
      expect(
        (
          history.body as {
            tariffs: { effectiveFrom: string; unitPriceCopKwh: string }[];
          }
        ).tariffs.map((t) => [t.effectiveFrom, t.unitPriceCopKwh]),
      ).toEqual([
        ['2026-10-12', '2000.0000'],
        ['2026-10-11', '1000.0000'],
      ]);
    });

    it('current tariff: the greatest effective date <= date, never a future one; null before the first', async () => {
      const at11 = await get(
        energy() + '/tariffs/current?at=2026-10-11',
        1,
      ).expect(200);
      expect(at11.body).toMatchObject({
        tariff: { unitPriceCopKwh: '1000.0000' },
      });
      const at20 = await get(
        energy() + '/tariffs/current?at=2026-10-20',
        1,
      ).expect(200);
      expect(at20.body).toMatchObject({
        tariff: { unitPriceCopKwh: '2000.0000' },
      });
      const at10 = await get(
        energy() + '/tariffs/current?at=2026-10-10',
        1,
      ).expect(200);
      expect(at10.body).toEqual({
        homeId: home(),
        at: '2026-10-10',
        tariff: null,
      });
    });

    it('T16/T17/T24: cost per reading with the tariff of its local date; without a tariff the cost is not presented as the total', async () => {
      const incomplete = await get(
        energy() + '/summary?month=2026-10',
        1,
      ).expect(200);
      expect(incomplete.body).toMatchObject({
        month: '2026-10',
        timezone: 'America/Bogota',
        from: '2026-10-01T05:00:00.000Z',
        to: '2026-11-01T05:00:00.000Z',
        readingsCount: 4,
        unpricedReadings: 1,
        totalKwh: '1.300000',
        costComplete: false,
        estimatedCostCop: null,
        // 0.2×1000 + 0.4×1000 (Oct 11) + 0.6×2000 (Oct 12); the Oct 10 reading has no tariff
        partialCostCop: '1800.00',
      });

      // Tariff change: a new earlier effective period (tariffs are not edited, they are added).
      await post(energy() + '/tariffs', 1, {
        unitPriceCopKwh: '500',
        effectiveFrom: '2026-10-01',
      }).expect(201);

      const complete = await get(energy() + '/summary?month=2026-10', 1).expect(
        200,
      );
      expect(complete.body).toMatchObject({
        unpricedReadings: 0,
        costComplete: true,
        // + 0.1×500 (Oct 10)
        estimatedCostCop: '1850.00',
        partialCostCop: '1850.00',
      });
    });

    it('T11/T23: goals with budget, kWh only or both; repeated PUT is idempotent and does not duplicate rows', async () => {
      const both = { monthlyBudgetCop: '2000.00', targetKwh: '1' };
      const first = await put(energy() + '/goals/2026-10', 1, both).expect(200);
      const second = await put(energy() + '/goals/2026-10', 1, both).expect(
        200,
      );
      const goalId = (first.body as { id: string }).id;
      expect((second.body as { id: string }).id).toBe(goalId);

      const summary = await get(energy() + '/summary?month=2026-10', 1).expect(
        200,
      );
      expect(summary.body).toMatchObject({
        monthlyBudgetCop: '2000.00',
        targetKwh: '1.000000',
        budgetUsagePercent: '92.50',
        targetUsagePercent: '130.00',
      });

      const kwhOnly = await put(energy() + '/goals/2026-10', 1, {
        monthlyBudgetCop: null,
        targetKwh: '1.3',
      }).expect(200);
      expect(kwhOnly.body).toMatchObject({
        id: goalId,
        monthlyBudgetCop: null,
        targetKwh: '1.300000',
      });

      const rows = await rls.withUserContext(user(1), (tx) =>
        tx.home_energy_goal.count({ where: { id_home: home() } }),
      );
      expect(rows).toBe(1);
    });

    it('T12: budget and target both null returns 400 and does not modify the stored goal', async () => {
      await put(energy() + '/goals/2026-10', 1, {
        monthlyBudgetCop: null,
        targetKwh: null,
      }).expect(400);
      const goal = await get(energy() + '/goals?month=2026-10', 1).expect(200);
      expect(goal.body).toMatchObject({
        goal: { monthlyBudgetCop: null, targetKwh: '1.300000' },
      });
    });

    it('T02/T03: an authorized MEMBER reads everything but cannot record tariffs or goals', async () => {
      for (const path of readPaths()) await get(path, 2).expect(200);
      // Consumption RLS (release 018): the MEMBER only sees readings of ACTIVE
      // devices with permission; it does not see those of the deactivated device (0.4) or the
      // deleted one (0.6). The summary respects that visibility: 0.1×500 + 0.2×1000.
      const summary = await get(energy() + '/summary?month=2026-10', 2).expect(
        200,
      );
      expect(summary.body).toMatchObject({
        readingsCount: 2,
        totalKwh: '0.300000',
        costComplete: true,
        estimatedCostCop: '250.00',
      });

      const tariff = await post(energy() + '/tariffs', 2, {
        unitPriceCopKwh: '1',
        effectiveFrom: '2026-10-20',
      }).expect(403);
      expect(tariff.body).toMatchObject({ code: 'ENERGY_MANAGE_FORBIDDEN' });
      await put(energy() + '/goals/2026-10', 2, {
        monthlyBudgetCop: '1',
        targetKwh: null,
      }).expect(403);

      const goal = await get(energy() + '/goals?month=2026-10', 1).expect(200);
      expect(goal.body).toMatchObject({ goal: { monthlyBudgetCop: null } });
    });

    it('T04/T22: a GUEST receives no economic data and keeps its aggregated consumption summary', async () => {
      for (const path of readPaths()) {
        const response = await get(path, 3).expect(403);
        expect(JSON.stringify(response.body)).not.toMatch(ECONOMIC_FIELDS);
      }
      await post(energy() + '/tariffs', 3, {
        unitPriceCopKwh: '1',
        effectiveFrom: '2026-10-21',
      }).expect(403);

      const consumption = await get(
        '/api/v1/homes/' + home() + '/consumption/summary',
        3,
      ).expect(200);
      expect(Object.keys(consumption.body as object).sort()).toEqual([
        'from',
        'homeId',
        'to',
        'totalEnergyDeltaKwh',
      ]);
    });

    it.each([4, 5, 6, 7, 9])(
      'T07/T08: user %s (no membership, PENDING, REVOKED, LEFT or previous creator) receives 403 without data',
      async (n) => {
        for (const path of readPaths()) {
          const response = await get(path, n).expect(403);
          expect(JSON.stringify(response.body)).not.toMatch(ECONOMIC_FIELDS);
        }
      },
    );

    it('T20: an inactive account or no token returns 401', async () => {
      for (const path of readPaths()) {
        await get(path, 8).expect(401);
        await http().get(path).expect(401);
      }
    });

    it('T05/T06: removing view_consumption from the MEMBER cuts economic access and restoring it gives it back', async () => {
      const member = await memberId(2);
      const [current] = await rls.withUserContext(
        user(1),
        (tx) =>
          tx.$queryRaw<
            {
              can_view_devices: boolean;
              can_view_consumption: boolean;
              can_control_devices: boolean;
            }[]
          >`SELECT * FROM homes.fn_get_member_permissions(${home()}::uuid, ${member}::uuid)`,
      );
      expect(current.can_view_consumption).toBe(true);

      const setViewConsumption = (value: boolean) =>
        rls.withUserContext(
          user(1),
          (tx) =>
            tx.$queryRaw<{ ok: boolean }[]>`
          SELECT homes.fn_set_member_permissions(${home()}::uuid, ${member}::uuid,
            ${current.can_view_devices}, ${value}, ${current.can_control_devices}) AS ok`,
        );

      try {
        await setViewConsumption(false);
        for (const path of readPaths()) await get(path, 2).expect(403);
      } finally {
        await setViewConsumption(true);
      }
      for (const path of readPaths()) await get(path, 2).expect(200);
    });

    it('T07: when the membership is revoked, the MEMBER immediately loses economic access', async () => {
      await get(energy() + '/summary?month=2026-10', 10).expect(200);
      const member = await memberId(10);
      await rls.withUserContext(user(1), (tx) =>
        tx.home_member.update({
          where: { id_home_member: member },
          data: { status: 'REVOKED', ended_at: new Date() },
        }),
      );
      for (const path of readPaths()) await get(path, 10).expect(403);
    });

    it('T19: deactivated home: the OWNER reads the history but cannot write; the MEMBER cannot read', async () => {
      await get(energy(3) + '/tariffs', 1).expect(200);
      await get(energy(3) + '/summary?month=2026-10', 1).expect(200);
      await post(energy(3) + '/tariffs', 1, {
        unitPriceCopKwh: '1',
        effectiveFrom: '2026-10-01',
      }).expect(403);
      await put(energy(3) + '/goals/2026-10', 1, {
        monthlyBudgetCop: '1',
        targetKwh: null,
      }).expect(403);
      await get(energy(3) + '/tariffs', 2).expect(403);
    });

    it('T15: two homes with the same tariff date are independent and do not cross', async () => {
      await post(energy(2) + '/tariffs', 4, {
        unitPriceCopKwh: '700',
        effectiveFrom: '2026-10-11',
      }).expect(201);
      const homeB = await get(energy(2) + '/tariffs', 4).expect(200);
      expect((homeB.body as { tariffs: unknown[] }).tariffs).toHaveLength(1);

      const summaryB = await get(
        energy(2) + '/summary?month=2026-10',
        4,
      ).expect(200);
      // 9 kWh on Oct 10 without an effective tariff (the 700 one applies from Oct 11)
      expect(summaryB.body).toMatchObject({
        totalKwh: '9.000000',
        costComplete: false,
        estimatedCostCop: null,
      });

      await get(energy(2) + '/tariffs', 1).expect(403);
      await get(energy() + '/tariffs', 4).expect(403);
      const homeA = await get(energy() + '/tariffs', 1).expect(200);
      expect((homeA.body as { tariffs: unknown[] }).tariffs).toHaveLength(3);
    });

    it('T10: the DB rejects editing or deleting tariffs, deleting goals or changing their month, even for the OWNER', async () => {
      await expect(
        rls.withUserContext(
          user(1),
          (tx) =>
            tx.$executeRaw`UPDATE config.home_energy_tariff SET unit_price_cop_kwh = 1 WHERE id_home = ${home()}::uuid`,
        ),
      ).rejects.toThrow();
      await expect(
        rls.withUserContext(
          user(1),
          (tx) =>
            tx.$executeRaw`DELETE FROM config.home_energy_tariff WHERE id_home = ${home()}::uuid`,
        ),
      ).rejects.toThrow();
      await expect(
        rls.withUserContext(
          user(1),
          (tx) =>
            tx.$executeRaw`DELETE FROM config.home_energy_goal WHERE id_home = ${home()}::uuid`,
        ),
      ).rejects.toThrow();
      await expect(
        rls.withUserContext(
          user(1),
          (tx) =>
            tx.$executeRaw`UPDATE config.home_energy_goal SET month_start = '2026-09-01' WHERE id_home = ${home()}::uuid`,
        ),
      ).rejects.toThrow();

      const history = await get(energy() + '/tariffs', 1).expect(200);
      expect((history.body as { tariffs: unknown[] }).tariffs).toHaveLength(3);
    });

    it('RLS is the last barrier: MEMBER and GUEST cannot insert tariffs or read rows even when bypassing the API', async () => {
      for (const n of [2, 3]) {
        await expect(
          rls.withUserContext(
            user(n),
            (tx) =>
              tx.$executeRaw`INSERT INTO config.home_energy_tariff (id_home, unit_price_cop_kwh, effective_from)
            VALUES (${home()}::uuid, 1, '2026-10-25')`,
          ),
        ).rejects.toThrow();
      }
      const guestRows = await rls.withUserContext(user(3), (tx) =>
        tx.home_energy_tariff.count(),
      );
      expect(guestRows).toBe(0);
      const outsiderRows = await rls.withUserContext(user(4), (tx) =>
        tx.home_energy_tariff.count({ where: { id_home: home() } }),
      );
      expect(outsiderRows).toBe(0);
    });

    it('T21: the same connection does not keep one user\'s context for the next', async () => {
      await get(energy() + '/summary?month=2026-10', 1).expect(200);
      const [context] = await prisma.$queryRaw<{ value: string | null }[]>`
      SELECT NULLIF(current_setting('app.current_user_id', true), '') AS value
    `;
      expect(context.value).toBeNull();
      await get(energy() + '/summary?month=2026-10', 3).expect(403);
      await get(energy() + '/summary?month=2026-10', 1).expect(200);
    });
  },
);
