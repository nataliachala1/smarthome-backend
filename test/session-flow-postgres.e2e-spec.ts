import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { PrismaRefreshTokenRepository } from '../src/modules/auth/infrastructure/persistence/prisma-refresh-token.repository';
import { RefreshTokenRepository } from '../src/modules/auth/domain/repositories/refresh-token.repository';
import { TokenService } from '../src/modules/auth/domain/ports/token-service.port';
import { SecureToken } from '../src/modules/auth/domain/ports/secure-token.port';
import { PasswordHasher } from '../src/modules/auth/domain/ports/password-hasher.port';
import { NodeSecureToken } from '../src/modules/auth/infrastructure/security/node-secure-token';
import { JwtTokenService } from '../src/modules/auth/infrastructure/security/jwt-token.service';
import { LoginUserUseCase } from '../src/modules/auth/application/use-cases/login-user.use-case';
import { RefreshSessionUseCase } from '../src/modules/auth/application/use-cases/refresh-session.use-case';
import { LogoutUseCase } from '../src/modules/auth/application/use-cases/logout.use-case';
import { LogoutAllUseCase } from '../src/modules/auth/application/use-cases/logout-all.use-case';
import { RegisterUserUseCase } from '../src/modules/auth/application/use-cases/register-user.use-case';
import { ActivateAccountUseCase } from '../src/modules/auth/application/use-cases/activate-account.use-case';
import { ResendActivationUseCase } from '../src/modules/auth/application/use-cases/resend-activation.use-case';
import { ForgotPasswordUseCase } from '../src/modules/auth/application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from '../src/modules/auth/application/use-cases/reset-password.use-case';
import { ChangePasswordUseCase } from '../src/modules/auth/application/use-cases/change-password.use-case';
import { RequestReactivationUseCase } from '../src/modules/auth/application/use-cases/request-reactivation.use-case';
import { ReactivateAccountUseCase } from '../src/modules/auth/application/use-cases/reactivate-account.use-case';
import { AuthController } from '../src/modules/auth/presentation/http/auth.controller';
import { JwtAuthGuard } from '../src/modules/auth/presentation/http/guards/jwt-auth.guard';
import { UserRepository } from '../src/modules/users/domain/repositories/user.repository';
import { User } from '../src/modules/users/domain/entities/user.entity';
import { UserStatus } from '../src/modules/users/domain/entities/user-status.enum';
import { SessionRevocationModule } from '../src/security/session-revocation.module';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import { RealtimeSessionService } from '../src/modules/realtime/realtime-session.service';
import { RealtimeEventsService } from '../src/modules/realtime/realtime-events.service';
import { RealtimeAccessService } from '../src/modules/realtime/realtime-access.service';
import { SecureIoAdapter } from '../src/modules/realtime/secure-io.adapter';

const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const userId = '10000000-0000-4000-8000-000000000001';
const origin = 'https://session.example.test';

describeDatabase('HTTP + Socket.IO + persisted session families', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let repository: PrismaRefreshTokenRepository;
  let sockets: Socket[];
  let url: string;
  let jwt: JwtService;
  const unusedUseCases = [
    RegisterUserUseCase,
    ActivateAccountUseCase,
    ResendActivationUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    ChangePasswordUseCase,
    RequestReactivationUseCase,
    ReactivateAccountUseCase,
  ];
  const account = new User({
    id: userId,
    roleId: randomUUID(),
    roleName: 'USER',
    name: 'Synthetic',
    email: 'synthetic@example.test',
    passwordHash: 'fixture-only',
    status: UserStatus.ACTIVE,
    emailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    deactivatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sessionVersion: 0,
  });

  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    if (
      parsed.hostname !== '127.0.0.1' ||
      parsed.pathname !== '/smarthome_session_test' ||
      parsed.username !== 'session_test'
    ) {
      throw new Error(
        'Only the disposable loopback session-test database is allowed',
      );
    }
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    await prisma.$connect();
    await prisma.$executeRaw`INSERT INTO auth."user"(id_user) VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`;
    repository = new PrismaRefreshTokenRepository(prisma);
    const fixture = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'synthetic-session-integration-secret' }),
        SessionRevocationModule,
      ],
      controllers: [AuthController],
      providers: [
        LoginUserUseCase,
        RefreshSessionUseCase,
        LogoutUseCase,
        LogoutAllUseCase,
        JwtAuthGuard,
        RealtimeGateway,
        RealtimeSessionService,
        RealtimeEventsService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            JWT_EXPIRES_IN: '5m',
            REFRESH_TOKEN_EXPIRES_DAYS: '1',
          }),
        },
        { provide: TokenService, useClass: JwtTokenService },
        { provide: SecureToken, useClass: NodeSecureToken },
        {
          provide: PasswordHasher,
          useValue: { verify: () => Promise.resolve(true) },
        },
        { provide: RefreshTokenRepository, useValue: repository },
        {
          provide: UserRepository,
          useValue: {
            findById: (id: string) =>
              Promise.resolve(id === userId ? account : null),
            findByEmail: () => Promise.resolve(account),
            registerSuccessfulLogin: () => Promise.resolve(),
          },
        },
        {
          provide: RealtimeAccessService,
          useValue: { canReceive: () => Promise.resolve(true) },
        },
        ...unusedUseCases.map((useCase) => ({
          provide: useCase,
          useValue: {},
        })),
      ],
    }).compile();
    app = fixture.createNestApplication();
    app.use(cookieParser());
    app.useWebSocketAdapter(new SecureIoAdapter(app, [origin]));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}/realtime`;
    jwt = app.get(JwtService);
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

  async function login() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: 'FixturePassword1!' })
      .expect(201);
    const body = response.body as { accessToken: string };
    const cookies = response.headers['set-cookie'] as unknown as string[];
    return { token: body.accessToken, cookie: cookies[0].split(';')[0] };
  }

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

  async function connect(accessToken: string) {
    const socket = io(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      extraHeaders: { Origin: origin },
      auth: { token: accessToken },
    });
    sockets.push(socket);
    const connected = waitFor(socket, 'realtime.connected');
    socket.connect();
    await connected;
    return socket;
  }

  const me = (accessToken: string) =>
    request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .auth(accessToken, { type: 'bearer' });
  const logout = (cookie: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .send({});
  const refresh = (cookie: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .send({});

  it('logs out one persisted family across HTTP and sockets while another login remains active', async () => {
    const a = await login();
    const b = await login();
    const claimsA = jwt.verify<{ sid: string }>(a.token);
    const claimsB = jwt.verify<{ sid: string }>(b.token);
    expect(claimsA.sid).not.toBe(claimsB.sid);
    await me(a.token).expect(200);
    await me(b.token).expect(200);
    const a1 = await connect(a.token);
    const a2 = await connect(a.token);
    const b1 = await connect(b.token);
    const disconnected = [waitFor(a1, 'disconnect'), waitFor(a2, 'disconnect')];
    await logout(a.cookie).expect(200);
    await Promise.all(disconnected);
    await me(a.token).expect(401);
    await me(b.token).expect(200);
    await refresh(a.cookie).expect(401);
    const received = waitFor(b1, 'notification.unread_count.updated');
    app
      .get(RealtimeEventsService)
      .emitToUser(userId, 'notification.unread_count.updated', {
        unreadCount: 1,
      });
    expect(await received).toEqual({ unreadCount: 1 });
  });

  it('preserves sid through refresh and lets logout with the rotated cookie close the family', async () => {
    const session = await login();
    const socket = await connect(session.token);
    const rotated = await refresh(session.cookie).expect(201);
    const body = rotated.body as { accessToken: string };
    expect(jwt.verify<{ sid: string }>(body.accessToken).sid).toBe(
      jwt.verify<{ sid: string }>(session.token).sid,
    );
    await me(session.token).expect(200);
    await me(body.accessToken).expect(200);
    expect(socket.connected).toBe(true);
    const disconnected = waitFor(socket, 'disconnect');
    await logout(session.cookie).expect(200);
    await disconnected;
    await me(body.accessToken).expect(401);
    await logout(session.cookie).expect(200);
  });

  it('revokes only the affected family when a replaced refresh token is replayed', async () => {
    const session = await login();
    const other = await login();
    const socket = await connect(session.token);
    const rotated = await refresh(session.cookie).expect(201);
    const disconnected = waitFor(socket, 'disconnect');
    await refresh(session.cookie).expect(401);
    await disconnected;
    await me((rotated.body as { accessToken: string }).accessToken).expect(401);
    await me(other.token).expect(200);
  });

  it.each([undefined, 'invalid', randomUUID()])(
    'rejects an unbound session claim %s in HTTP and Socket.IO',
    async (sid) => {
      const payload: Record<string, unknown> = {
        sub: userId,
        role: 'USER',
        sv: 0,
      };
      if (sid !== undefined) payload.sid = sid;
      const accessToken = jwt.sign(payload, { expiresIn: '5m' });
      await me(accessToken).expect(401);
      const socket = io(url, {
        autoConnect: false,
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
        extraHeaders: { Origin: origin },
        auth: { token: accessToken },
      });
      sockets.push(socket);
      const rejected = waitFor(socket, 'connect_error');
      socket.connect();
      await rejected;
      expect(socket.connected).toBe(false);
    },
  );

  it('denies a family revoked elsewhere before delivering its next event', async () => {
    const session = await login();
    const socket = await connect(session.token);
    const claims = jwt.verify<{ sid: string }>(session.token);
    await repository.revokeFamily(claims.sid);
    await me(session.token).expect(401);
    const received = jest.fn();
    socket.on('notification.unread_count.updated', received);
    const disconnected = waitFor(socket, 'disconnect');
    app
      .get(RealtimeEventsService)
      .emitToUser(userId, 'notification.unread_count.updated', {
        unreadCount: 2,
      });
    await disconnected;
    expect(received).not.toHaveBeenCalled();
  });

  it('revokes a family after concurrent refresh reuse even if one response already succeeded', async () => {
    const session = await login();
    const responses = await Promise.all([
      refresh(session.cookie),
      refresh(session.cookie),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 401,
    ]);
    const claims = jwt.verify<{ sid: string }>(session.token);
    await expect(
      repository.hasActiveFamily(userId, claims.sid, 0),
    ).resolves.toBe(false);
    await me(session.token).expect(401);
  });

  it('keeps anonymous logout idempotent', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({})
      .expect(200);
  });
});
