import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { getTrustedProxies } from '../src/config/trusted-proxies';
import { RateLimitModule } from '../src/security/rate-limit.module';
import { HealthController } from '../src/health/health.controller';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { AuthController } from '../src/modules/auth/presentation/http/auth.controller';
import { JwtAuthGuard } from '../src/modules/auth/presentation/http/guards/jwt-auth.guard';
import { InvalidCredentialsError } from '../src/modules/auth/domain/errors/invalid-credentials.error';
import { RegisterUserUseCase } from '../src/modules/auth/application/use-cases/register-user.use-case';
import { ActivateAccountUseCase } from '../src/modules/auth/application/use-cases/activate-account.use-case';
import { LoginUserUseCase } from '../src/modules/auth/application/use-cases/login-user.use-case';
import { ResendActivationUseCase } from '../src/modules/auth/application/use-cases/resend-activation.use-case';
import { ForgotPasswordUseCase } from '../src/modules/auth/application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from '../src/modules/auth/application/use-cases/reset-password.use-case';
import { ChangePasswordUseCase } from '../src/modules/auth/application/use-cases/change-password.use-case';
import { RefreshSessionUseCase } from '../src/modules/auth/application/use-cases/refresh-session.use-case';
import { LogoutUseCase } from '../src/modules/auth/application/use-cases/logout.use-case';
import { LogoutAllUseCase } from '../src/modules/auth/application/use-cases/logout-all.use-case';
import { RequestReactivationUseCase } from '../src/modules/auth/application/use-cases/request-reactivation.use-case';
import { ReactivateAccountUseCase } from '../src/modules/auth/application/use-cases/reactivate-account.use-case';

// Real HTTP controllers, pipes, guard and storage; no DB, SMTP, MQTT or hardware.
jest.mock('../src/infrastructure/database/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const useCases = [
  RegisterUserUseCase,
  ActivateAccountUseCase,
  LoginUserUseCase,
  ResendActivationUseCase,
  ForgotPasswordUseCase,
  ResetPasswordUseCase,
  ChangePasswordUseCase,
  RefreshSessionUseCase,
  LogoutUseCase,
  LogoutAllUseCase,
  RequestReactivationUseCase,
  ReactivateAccountUseCase,
] as const;

const emailBody = { email: 'synthetic@example.test' };
const passwordBody = {
  password: 'Synthetic1!',
  passwordConfirmation: 'Synthetic1!',
};
const loginBody = { ...emailBody, password: passwordBody.password };
const tokenBody = { token: 'synthetic-token' };

describe('HTTP rate limiting (isolated integration)', () => {
  let app: INestApplication<App>;
  let expressApp: Express;
  let execute: Map<unknown, jest.Mock>;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    execute = new Map(
      useCases.map((useCase) => [
        useCase,
        jest.fn().mockResolvedValue({ message: 'ok' }),
      ]),
    );
    execute
      .get(LoginUserUseCase)!
      .mockRejectedValue(new InvalidCredentialsError());
    execute.get(RefreshSessionUseCase)!.mockResolvedValue({
      accessToken: 'synthetic-access',
      tokenType: 'Bearer',
      refreshToken: 'synthetic-refresh',
      refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);

    const fixture = await Test.createTestingModule({
      imports: [RateLimitModule],
      controllers: [AuthController, HealthController],
      providers: [
        ...useCases.map((useCase) => ({
          provide: useCase,
          useValue: { execute: execute.get(useCase) },
        })),
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = fixture.createNestApplication();
    expressApp = app.getHttpAdapter().getInstance() as Express;
    expressApp.set('trust proxy', getTrustedProxies(''));
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (app) await app.close();
  });

  const post = (route: string, body: object, forwardedFor?: string) => {
    const pending = request(app.getHttpServer())
      .post(`/api/v1/auth/${route}`)
      .set('Cookie', 'refresh_token=synthetic-refresh')
      .send(body);
    return forwardedFor
      ? pending.set('X-Forwarded-For', forwardedFor)
      : pending;
  };

  it.each([
    {
      route: 'register',
      body: { name: 'Synthetic', ...emailBody, ...passwordBody },
      limit: 5,
      useCase: RegisterUserUseCase,
      status: 201,
    },
    {
      route: 'resend-activation',
      body: emailBody,
      limit: 5,
      useCase: ResendActivationUseCase,
      status: 201,
    },
    {
      route: 'forgot-password',
      body: emailBody,
      limit: 5,
      useCase: ForgotPasswordUseCase,
      status: 201,
    },
    {
      route: 'request-reactivation',
      body: emailBody,
      limit: 5,
      useCase: RequestReactivationUseCase,
      status: 201,
    },
    {
      route: 'activate',
      body: tokenBody,
      limit: 10,
      useCase: ActivateAccountUseCase,
      status: 201,
    },
    {
      route: 'reactivate',
      body: tokenBody,
      limit: 10,
      useCase: ReactivateAccountUseCase,
      status: 201,
    },
    {
      route: 'reset-password',
      body: { ...tokenBody, ...passwordBody },
      limit: 10,
      useCase: ResetPasswordUseCase,
      status: 201,
    },
    {
      route: 'login',
      body: loginBody,
      limit: 10,
      useCase: LoginUserUseCase,
      status: 401,
    },
    {
      route: 'refresh',
      body: {},
      limit: 30,
      useCase: RefreshSessionUseCase,
      status: 201,
    },
  ])(
    'protects $route before invoking its use case over quota',
    async ({ route, body, limit, useCase, status }) => {
      for (let index = 0; index < limit; index++) {
        await post(route, body).expect(status);
      }
      const response = await post(route, body).expect(429);
      expect(response.body).toEqual({
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Demasiadas solicitudes. Intenta nuevamente más tarde.',
        retryAfterSeconds: 60,
      });
      expect(response.headers['retry-after']).toBe('60');
      expect(execute.get(useCase)).toHaveBeenCalledTimes(limit);
    },
  );

  it('preserves a successful login and keeps refresh credentials out of its JSON', async () => {
    const user = {
      id: 'synthetic-user',
      name: 'Synthetic',
      email: emailBody.email,
      role: 'USER',
    };
    execute.get(LoginUserUseCase)!.mockResolvedValue({
      accessToken: 'synthetic-access',
      tokenType: 'Bearer',
      user,
      refreshToken: 'synthetic-refresh',
      refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    const response = await post('login', loginBody).expect(201);
    expect(response.body).toEqual({
      accessToken: 'synthetic-access',
      tokenType: 'Bearer',
      user,
    });
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^refresh_token=synthetic-refresh;.*HttpOnly/),
      ]),
    );
  });

  it('counts invalid payloads before DTO validation on change-password', async () => {
    for (let index = 0; index < 5; index++) {
      await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .send({})
        .expect(400);
    }
    await request(app.getHttpServer())
      .patch('/api/v1/auth/change-password')
      .send({})
      .expect(429);
    expect(execute.get(ChangePasswordUseCase)).not.toHaveBeenCalled();
  });

  it('does not bypass login limits by changing email, query or forwarded headers on direct connections', async () => {
    for (let index = 0; index < 10; index++) {
      await post(
        `login?nonce=${index}`,
        { ...loginBody, email: `test${index}@example.test` },
        `192.0.2.${index + 1}`,
      ).expect(401);
    }
    await post('login?nonce=another', loginBody, '198.51.100.10').expect(429);
    expect(execute.get(LoginUserUseCase)).toHaveBeenCalledTimes(10);
  });

  it('ignores forwarded headers from a peer outside the trusted proxy list', async () => {
    expressApp.set('trust proxy', getTrustedProxies('192.0.2.254/32'));
    for (let index = 0; index < 5; index++) {
      await post(
        'forgot-password',
        emailBody,
        `198.51.100.${index + 1}`,
      ).expect(201);
    }
    await post('forgot-password', emailBody, '198.51.100.200').expect(429);
  });

  it('isolates clients behind a trusted proxy and ignores spoofed entries preceding the first untrusted hop', async () => {
    expressApp.set('trust proxy', getTrustedProxies('127.0.0.1/32'));
    for (let index = 0; index < 5; index++) {
      await post(
        'forgot-password',
        emailBody,
        `198.51.100.${index + 1}, 192.0.2.10`,
      ).expect(201);
    }
    await post('forgot-password', emailBody, '203.0.113.50, 192.0.2.10').expect(
      429,
    );
    await post('forgot-password', emailBody, '192.0.2.11').expect(201);
  });

  it('does not block another auth handler or logout when login is exhausted', async () => {
    for (let index = 0; index < 10; index++)
      await post('login', loginBody).expect(401);
    await post('login', loginBody).expect(429);
    await post('forgot-password', emailBody).expect(201);
    await post('logout', {}).expect(200);
    expect(execute.get(LogoutUseCase)).toHaveBeenCalledTimes(1);
  });

  it('accepts a request after Retry-After without extending the block on denied traffic', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    for (let index = 0; index < 5; index++)
      await post('forgot-password', emailBody).expect(201);
    await post('forgot-password', emailBody).expect(429);
    now += 30_000;
    const response = await post('forgot-password', emailBody).expect(429);
    expect(response.headers['retry-after']).toBe('30');
    now += 30_000;
    await post('forgot-password', emailBody).expect(201);
    expect(execute.get(ForgotPasswordUseCase)).toHaveBeenCalledTimes(6);
  });

  it('limits readiness queries while keeping liveness independent of DB and quotas', async () => {
    for (let index = 0; index < 120; index++) {
      await request(app.getHttpServer()).get('/health/ready').expect(200);
    }
    await request(app.getHttpServer()).get('/health/ready').expect(429);
    expect(queryRaw).toHaveBeenCalledTimes(120);
    for (let index = 0; index < 121; index++) {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    }
    expect(queryRaw).toHaveBeenCalledTimes(120);
  });
});
