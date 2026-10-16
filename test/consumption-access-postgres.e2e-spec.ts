import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { PrismaRlsService } from '../src/infrastructure/database/prisma/prisma-rls.service';
import { PrismaUserRepository } from '../src/modules/users/infrastructure/persistence/prisma-user.repository';
import { UserRepository } from '../src/modules/users/domain/repositories/user.repository';
import { PrismaRefreshTokenRepository } from '../src/modules/auth/infrastructure/persistence/prisma-refresh-token.repository';
import { RefreshTokenRepository } from '../src/modules/auth/domain/repositories/refresh-token.repository';
import { JwtAuthGuard } from '../src/modules/auth/presentation/http/guards/jwt-auth.guard';
import { ConsumptionController } from '../src/modules/consumption/presentation/controllers/consumption.controller';
import { HomeConsumptionController } from '../src/modules/consumption/presentation/controllers/home-consumption.controller';
import { ListHomeConsumptionUseCase } from '../src/modules/consumption/application/use-cases/list-home-consumption.use-case';
import { ListDeviceConsumptionUseCase } from '../src/modules/consumption/application/use-cases/list-device-consumption.use-case';
import { GetHomeDailyConsumptionUseCase } from '../src/modules/consumption/application/use-cases/get-home-daily-consumption.use-case';
import { GetDeviceDailyConsumptionUseCase } from '../src/modules/consumption/application/use-cases/get-device-daily-consumption.use-case';
import { GetHomeConsumptionSummaryUseCase } from '../src/modules/consumption/application/use-cases/get-home-consumption-summary.use-case';
import { GetDeviceConsumptionSummaryUseCase } from '../src/modules/consumption/application/use-cases/get-device-consumption-summary.use-case';
import { PrismaDeviceRepository } from '../src/modules/devices/infrastructure/persistence/prisma-device.repository';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import { RealtimeSessionService } from '../src/modules/realtime/realtime-session.service';
import { RealtimeAccessService } from '../src/modules/realtime/realtime-access.service';
import { RealtimeEventsService } from '../src/modules/realtime/realtime-events.service';
import { SecureIoAdapter } from '../src/modules/realtime/secure-io.adapter';
import { SessionRevocationModule } from '../src/security/session-revocation.module';

const databaseUrl = process.env.CONSUMPTION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const user = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const home = (n = 1) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const device = (n = 1) =>
  `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const family = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const homePath = (n = 1) => `/api/v1/homes/${home(n)}/consumption`;
const devicePath = (n = 1, h = 1) =>
  `/api/v1/homes/${home(h)}/devices/${device(n)}/consumption`;
const paths = [
  homePath(),
  `${homePath()}/daily`,
  `${homePath()}/summary`,
  devicePath(),
  `${devicePath()}/daily`,
  `${devicePath()}/summary`,
];

describeDatabase(
  'Consumption HTTP/JWT/RLS and Socket.IO with non-owner LOGIN',
  () => {
    let app: INestApplication<Server>;
    let prisma: PrismaClient;
    let rls: PrismaRlsService;
    let jwt: JwtService;
    let sockets: Socket[];
    let socketUrl: string;

    beforeAll(async () => {
      const parsed = new URL(databaseUrl!);
      if (
        parsed.hostname !== '127.0.0.1' ||
        parsed.pathname !== '/smarthome_consumption_test' ||
        parsed.username !== 'consumption_app_test'
      ) {
        throw new Error(
          'Only the disposable consumption database and non-owner LOGIN are allowed',
        );
      }
      // Force reuse of one physical connection; context must be transaction-local.
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }),
      });
      await prisma.$connect();
      const fixture = await Test.createTestingModule({
        imports: [
          JwtModule.register({ secret: 'synthetic-consumption-test-only' }),
          SessionRevocationModule,
        ],
        controllers: [ConsumptionController, HomeConsumptionController],
        providers: [
          { provide: PrismaService, useValue: prisma },
          PrismaRlsService,
          JwtAuthGuard,
          { provide: UserRepository, useClass: PrismaUserRepository },
          {
            provide: RefreshTokenRepository,
            useClass: PrismaRefreshTokenRepository,
          },
          ListHomeConsumptionUseCase,
          ListDeviceConsumptionUseCase,
          GetHomeDailyConsumptionUseCase,
          GetDeviceDailyConsumptionUseCase,
          GetHomeConsumptionSummaryUseCase,
          GetDeviceConsumptionSummaryUseCase,
          RealtimeGateway,
          RealtimeSessionService,
          RealtimeAccessService,
          RealtimeEventsService,
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
      app.useWebSocketAdapter(
        new SecureIoAdapter(app, ['https://consumption.example.test']),
      );
      await app.listen(0, '127.0.0.1');
      socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/realtime`;
      jwt = app.get(JwtService);
      rls = app.get(PrismaRlsService);
    });
    beforeEach(() => {
      sockets = [];
    });
    afterEach(() => {
      for (const socket of sockets) socket.disconnect();
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
    const get = (path: string, n: number) =>
      request(app.getHttpServer()).get(path).auth(token(n), { type: 'bearer' });

    it('uses a real LOGIN without superuser, BYPASSRLS, elevated-role or table-owner memberships', async () => {
      const [role] = await prisma.$queryRaw<
        { session_user: string; current_user: string; unsafe: boolean }[]
      >`
      SELECT session_user::text, current_user::text,
        EXISTS (SELECT 1 FROM pg_roles r WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole)
          AND pg_has_role(session_user, r.oid, 'MEMBER')) AS unsafe
    `;
      expect(role).toEqual({
        session_user: 'consumption_app_test',
        current_user: 'consumption_app_test',
        unsafe: false,
      });
      const [owners] = await prisma.$queryRaw<{ unsafe: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('consumption','homes','devices') AND c.relkind IN ('r','p')
          AND pg_has_role(session_user,c.relowner,'MEMBER')) AS unsafe
    `;
      expect(owners.unsafe).toBe(false);
    });

    it.each([1, 2])(
      'allows OWNER/MEMBER user %s on all six consumption routes',
      async (n) => {
        for (const path of paths) await get(path, n).expect(200);
      },
    );

    it.each([4, 5, 6, 7, 9])(
      'denies outsider/pending/revoked/left/former creator %s on every route',
      async (n) => {
        for (const path of paths) await get(path, n).expect(403);
      },
    );

    it('rejects an inactive account through the real JWT guard', async () => {
      for (const path of paths) await get(path, 8).expect(401);
    });

    it('gives GUEST exactly the approved household total and requested period', async () => {
      const from = '2026-10-11T00:00:00.000Z';
      const to = '2026-10-11T23:59:59.000Z';
      const response = await get(
        `${homePath()}/summary?from=${from}&to=${to}`,
        3,
      ).expect(200);
      expect(response.body).toEqual({
        homeId: home(),
        from,
        to,
        totalEnergyDeltaKwh: 0.6,
      });
      const all = await get(`${homePath()}/summary`, 3).expect(200);
      expect(all.body).toEqual({
        homeId: home(),
        from: null,
        to: null,
        totalEnergyDeltaKwh: 1.3,
      });
    });

    it('denies all five detail routes to GUEST', async () => {
      for (const path of paths.filter(
        (path) => path !== `${homePath()}/summary`,
      )) {
        const response = await get(path, 3).expect(403);
        expect((response.body as { code: string }).code).toBe(
          'CONSUMPTION_DETAIL_FORBIDDEN',
        );
      }
    });

    it.each([1, 2])(
      'preserves access to removed/inactive device histories for user %s',
      async (n) => {
        for (const d of [2, 3])
          for (const suffix of ['', '/summary', '/daily'])
            await get(`${devicePath(d)}${suffix}`, n).expect(200);
        const listed = await get(homePath(), n).expect(200);
        expect(listed.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              deviceId: device(2),
              deviceName: 'Inactive synthetic',
            }),
            expect.objectContaining({
              deviceId: device(3),
              deviceName: 'Removed synthetic',
            }),
          ]),
        );
      },
    );

    it('does not turn historical visibility into permission to control an inactive device', async () => {
      const repo = new PrismaDeviceRepository(rls);
      await expect(
        repo.findForControl(user(2), home(), device(2)),
      ).resolves.toBeNull();
      await expect(
        repo.findForControl(user(2), home(), device(3)),
      ).resolves.toBeNull();
    });

    it('never combines a device from one home with authorization for another', async () => {
      for (const suffix of ['', '/summary', '/daily'])
        await get(`${devicePath(4)}${suffix}`, 2).expect(404);
      const total = await get(`${homePath()}/summary`, 2).expect(200);
      expect(
        (total.body as { totalEnergyDeltaKwh: number }).totalEnergyDeltaKwh,
      ).toBe(1.3);
    });

    it('returns known kWh/W totals, date filters and limits without foreign rows', async () => {
      const summary = await get(`${devicePath()}/summary`, 2).expect(200);
      expect(summary.body).toMatchObject({
        totalEnergyDeltaKwh: 0.3,
        latestEnergyTotalKwh: 10.3,
        averagePowerW: 150,
        readingsCount: 2,
      });
      const listed = await get(`${homePath()}?limit=1`, 2).expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body).toEqual([
        expect.objectContaining({ deviceId: device(3) }),
      ]);
    });

    it('returns an empty history instead of treating an existing empty device as missing', async () => {
      const response = await get(devicePath(5), 2).expect(200);
      expect(response.body).toEqual([]);
      const summary = await get(`${devicePath(5)}/summary`, 2).expect(200);
      expect(summary.body).toMatchObject({
        readingsCount: 0,
        totalEnergyDeltaKwh: 0,
      });
    });

    it.each([
      'limit=0',
      'limit=201',
      'from=invalid',
      'from=2026-10-12&to=2026-10-10',
    ])('rejects invalid queries %s', async (query) => {
      await get(`${homePath()}?${query}`, 2).expect(400);
    });

    it('enforces row security directly for raw readings, metrics and metadata', async () => {
      for (const n of [3, 4, 5, 6, 7, 9]) {
        const result = await rls.withUserContext(user(n), async (tx) => ({
          readings: await tx.consumption.count({ where: { id_home: home() } }),
          metrics: await tx.consumption_metric.count({
            where: { id_home: home() },
          }),
          metadata:
            await tx.$queryRaw`SELECT * FROM consumption.fn_history_devices(${home()}::uuid, ARRAY[${device(3)}::uuid])`,
        }));
        expect(result).toEqual({ readings: 0, metrics: 0, metadata: [] });
      }
    });

    it('preserves the previous OWNER historical rule for inactive homes and denies MEMBER', async () => {
      await get(`${homePath(3)}/summary`, 1).expect(200);
      await get(`${homePath(3)}/summary`, 2).expect(403);
      await get(`${devicePath(6, 3)}/summary`, 1).expect(200);
      await get(`${devicePath(6, 3)}/summary`, 2).expect(403);
    });

    it('limits positive direct reads and historical metadata to the authorized home', async () => {
      const result = await rls.withUserContext(user(2), async (tx) => ({
        readings: await tx.consumption.count(),
        metrics: await tx.consumption_metric.count(),
        metadata: await tx.$queryRaw<
          { id_device: string }[]
        >`SELECT id_device FROM consumption.fn_history_devices(${home()}::uuid, ARRAY[${device(3)}::uuid,${device(4)}::uuid])`,
      }));
      expect(result).toEqual({
        readings: 4,
        metrics: 1,
        metadata: [{ id_device: device(3) }],
      });
    });

    it('does not grant PUBLIC execution on the new security-definer functions', async () => {
      const rows = await prisma.$queryRaw<
        { proname: string; prosecdef: boolean; public_execute: boolean }[]
      >`
      SELECT p.proname::text,p.prosecdef,
        EXISTS(SELECT 1 FROM aclexplode(p.proacl) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='consumption' AND p.proname IN ('fn_can_read_detail','fn_history_devices','fn_basic_home_consumption')
    `;
      expect(rows).toHaveLength(3);
      for (const row of rows)
        expect(row).toMatchObject({ prosecdef: true, public_execute: false });
    });

    it('reuses one physical connection without retaining context after success or failure', async () => {
      const [before] = await prisma.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      for (const n of [1, 3, 2, 4, 2, 5, 1])
        await get(homePath(), n).expect([1, 2].includes(n) ? 200 : 403);
      const [after] = await prisma.$queryRaw<
        { pid: number; context: string | null; count: bigint }[]
      >`
      SELECT pg_backend_pid() AS pid, NULLIF(current_setting('app.current_user_id',true),'') AS context,
        (SELECT count(*) FROM consumption.consumption) AS count
    `;
      expect(after).toEqual({ pid: before.pid, context: null, count: 0n });
    });

    function waitFor<T = unknown>(socket: Socket, event: string): Promise<T> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off(event, listener);
          reject(new Error(`Missing ${event}`));
        }, 3000);
        const listener = (value: T) => {
          clearTimeout(timer);
          resolve(value);
        };
        socket.once(event, listener);
      });
    }
    async function connect(n: number): Promise<Socket> {
      const socket = io(socketUrl, {
        autoConnect: false,
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
        extraHeaders: { Origin: 'https://consumption.example.test' },
        auth: { token: token(n) },
      });
      sockets.push(socket);
      const done = waitFor(socket, 'realtime.connected');
      socket.connect();
      await done;
      return socket;
    }
    async function barrier(socket: Socket, n: number): Promise<void> {
      const done = waitFor(socket, 'notification.unread_count.updated');
      app
        .get(RealtimeEventsService)
        .emitToUser(user(n), 'notification.unread_count.updated', {
          unreadCount: 0,
        });
      await done;
    }

    it('delivers household events only to authorized realtime recipients using real RLS', async () => {
      const member = await connect(2);
      const guest = await connect(3);
      const outsider = await connect(4);
      const memberEvent = waitFor(member, 'consumption.created');
      const guestEvent = jest.fn();
      const outsiderEvent = jest.fn();
      guest.on('consumption.created', guestEvent);
      outsider.on('consumption.created', outsiderEvent);
      const payload = { homeId: home(), deviceId: device(), powerW: 100 };
      for (const n of [2, 3, 4])
        app
          .get(RealtimeEventsService)
          .emitToUser(user(n), 'consumption.created', payload);
      expect(await memberEvent).toEqual(payload);
      await barrier(guest, 3);
      await barrier(outsider, 4);
      expect(guestEvent).not.toHaveBeenCalled();
      expect(outsiderEvent).not.toHaveBeenCalled();
    });

    it('removes HTTP and realtime detail access after membership revocation commits', async () => {
      const socket = await connect(10);
      await get(homePath(), 10).expect(200);
      const membership = await rls.withUserContext(user(1), (tx) =>
        tx.home_member.findFirst({
          where: { id_user: user(10), id_home: home() },
        }),
      );
      await rls.withUserContext(user(1), (tx) =>
        tx.home_member.update({
          where: { id_home_member: membership!.id_home_member },
          data: { status: 'REVOKED', ended_at: new Date() },
        }),
      );
      await get(homePath(), 10).expect(403);
      const received = jest.fn();
      socket.on('consumption.created', received);
      app
        .get(RealtimeEventsService)
        .emitToUser(user(10), 'consumption.created', {
          homeId: home(),
          powerW: 100,
        });
      await barrier(socket, 10);
      expect(received).not.toHaveBeenCalled();
    });
  },
);
