jest.mock('./guards/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AccountLockedError } from '../../domain/errors/account-locked.error';
import { AccountNotActiveError } from '../../domain/errors/account-not-active.error';
import { EmailAlreadyExistsError } from '../../domain/errors/email-already-exists.error';
import { InvalidActivationTokenError } from '../../domain/errors/invalid-activation-token.error';
import { InvalidCredentialsError } from '../../domain/errors/invalid-credentials.error';
import { InvalidCurrentPasswordError } from '../../domain/errors/invalid-current-password.error';
import { InvalidPasswordResetTokenError } from '../../domain/errors/invalid-password-reset-token.error';
import { InvalidRefreshTokenError } from '../../domain/errors/invalid-refresh-token.error';
import { PasswordsDoNotMatchError } from '../../domain/errors/passwords-do-not-match.error';
import { AuthController } from './auth.controller';

type UseCase = { execute: jest.Mock };

function useCase(result: unknown = { ok: true }): UseCase {
  return { execute: jest.fn().mockResolvedValue(result) };
}

function setup() {
  const cases = {
    register: useCase(),
    activate: useCase(),
    login: useCase({
      accessToken: 'access',
      tokenType: 'Bearer',
      user: { id: 'u1' },
      refreshToken: 'refresh',
      refreshTokenExpiresAt: new Date('2030-01-01T00:00:00Z'),
    }),
    resend: useCase(),
    forgot: useCase(),
    reset: useCase(),
    change: useCase(),
    refresh: useCase({
      accessToken: 'access-2',
      tokenType: 'Bearer',
      refreshToken: 'refresh-2',
      refreshTokenExpiresAt: new Date('2030-01-02T00:00:00Z'),
    }),
    logout: useCase(undefined),
    logoutAll: useCase(undefined),
    requestReactivation: useCase(),
    reactivate: useCase(),
  };
  const controller = new AuthController(
    ...(Object.values(cases) as unknown as ConstructorParameters<typeof AuthController>),
  );
  const response = { cookie: jest.fn(), clearCookie: jest.fn() };
  return { controller, cases, response: response as unknown as Response & typeof response };
}

const mocks = (r: unknown) => r as { cookie: jest.Mock; clearCookie: jest.Mock };
const request = (cookies: Record<string, unknown> = {}) => ({ cookies }) as unknown as Request;
const user = { userId: 'u1', role: 'USER' };

describe('AuthController', () => {
  it('returns the authenticated user on /me', () => {
    expect(setup().controller.me(user)).toBe(user);
  });

  it.each([
    ['register', 'register'],
    ['activate', 'activate'],
    ['resendActivation', 'resend'],
    ['forgotPassword', 'forgot'],
    ['resetPassword', 'reset'],
    ['requestReactivation', 'requestReactivation'],
    ['reactivate', 'reactivate'],
  ] as const)('%s delegates the body to its use case', async (method, key) => {
    const { controller, cases } = setup();
    const dto = { any: 'value' };
    await expect((controller[method] as (d: unknown) => Promise<unknown>)(dto)).resolves.toEqual({ ok: true });
    expect(cases[key].execute).toHaveBeenCalledWith(dto);
  });

  it.each([
    ['register', 'register', new PasswordsDoNotMatchError(), BadRequestException],
    ['register', 'register', new EmailAlreadyExistsError(), ConflictException],
    ['activate', 'activate', new InvalidActivationTokenError(), BadRequestException],
    ['resetPassword', 'reset', new PasswordsDoNotMatchError(), BadRequestException],
    ['resetPassword', 'reset', new InvalidPasswordResetTokenError(), BadRequestException],
    ['reactivate', 'reactivate', new InvalidActivationTokenError(), BadRequestException],
  ] as const)('%s maps %p to the matching HTTP error', async (method, key, error, httpError) => {
    const { controller, cases } = setup();
    cases[key].execute.mockRejectedValueOnce(error);
    await expect((controller[method] as (d: unknown) => Promise<unknown>)({})).rejects.toBeInstanceOf(httpError);
  });

  it.each(['register', 'activate', 'resetPassword', 'reactivate'] as const)(
    '%s rethrows unknown errors for the global filter',
    async (method) => {
      const { controller, cases } = setup();
      const key = { register: 'register', activate: 'activate', resetPassword: 'reset', reactivate: 'reactivate' }[method] as keyof typeof cases;
      const unexpected = new Error('database down');
      cases[key].execute.mockRejectedValueOnce(unexpected);
      await expect((controller[method] as (d: unknown) => Promise<unknown>)({})).rejects.toBe(unexpected);
    },
  );

  describe('changePassword', () => {
    const dto = { currentPassword: 'old', newPassword: 'New#2026a', newPasswordConfirmation: 'New#2026a' };

    it('passes the authenticated user id to the use case', async () => {
      const { controller, cases } = setup();
      await controller.changePassword(user, dto);
      expect(cases.change.execute).toHaveBeenCalledWith({ userId: 'u1', ...dto });
    });

    it.each([new PasswordsDoNotMatchError(), new InvalidCurrentPasswordError()])('maps %p to 400', async (error) => {
      const { controller, cases } = setup();
      cases.change.execute.mockRejectedValueOnce(error);
      await expect(controller.changePassword(user, dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rethrows unknown errors', async () => {
      const { controller, cases } = setup();
      cases.change.execute.mockRejectedValueOnce(new Error('x'));
      await expect(controller.changePassword(user, dto)).rejects.toThrow('x');
    });
  });

  describe('login', () => {
    it('sets the refresh token only as an httpOnly cookie', async () => {
      const { controller, response } = setup();
      const body = await controller.login({ email: 'a@example.com', password: 'p' }, response);

      expect(body).toEqual({ accessToken: 'access', tokenType: 'Bearer', user: { id: 'u1' } });
      expect(JSON.stringify(body)).not.toContain('refresh');
      expect(mocks(response).cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh',
        expect.objectContaining({ httpOnly: true, path: '/api/v1/auth' }),
      );
    });

    it.each([
      [new InvalidCredentialsError(), UnauthorizedException],
      [new AccountNotActiveError(), ForbiddenException],
      [new AccountLockedError(new Date()), ForbiddenException],
    ])('maps %p', async (error, httpError) => {
      const { controller, cases, response } = setup();
      cases.login.execute.mockRejectedValueOnce(error);
      await expect(controller.login({ email: 'a', password: 'b' }, response)).rejects.toBeInstanceOf(httpError);
      expect(mocks(response).cookie).not.toHaveBeenCalled();
    });

    it('rethrows unknown errors', async () => {
      const { controller, cases, response } = setup();
      cases.login.execute.mockRejectedValueOnce(new Error('x'));
      await expect(controller.login({ email: 'a', password: 'b' }, response)).rejects.toThrow('x');
    });
  });

  describe('refresh', () => {
    it('requires the refresh cookie', async () => {
      const { controller, response } = setup();
      await expect(controller.refresh(request(), response)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(controller.refresh(request({ refresh_token: 42 }), response)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rotates the cookie and returns a new access token', async () => {
      const { controller, cases, response } = setup();
      await expect(controller.refresh(request({ refresh_token: 'old' }), response)).resolves.toEqual({
        accessToken: 'access-2',
        tokenType: 'Bearer',
      });
      expect(cases.refresh.execute).toHaveBeenCalledWith('old');
      expect(mocks(response).cookie).toHaveBeenCalledWith('refresh_token', 'refresh-2', expect.any(Object));
    });

    it('clears the cookie when the refresh token is invalid', async () => {
      const { controller, cases, response } = setup();
      cases.refresh.execute.mockRejectedValueOnce(new InvalidRefreshTokenError());
      await expect(controller.refresh(request({ refresh_token: 'stolen' }), response)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mocks(response).clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
    });

    it('rethrows unknown errors without clearing the cookie', async () => {
      const { controller, cases, response } = setup();
      cases.refresh.execute.mockRejectedValueOnce(new Error('x'));
      await expect(controller.refresh(request({ refresh_token: 't' }), response)).rejects.toThrow('x');
      expect(mocks(response).clearCookie).not.toHaveBeenCalled();
    });
  });

  it('logout revokes the cookie session and clears it', async () => {
    const { controller, cases, response } = setup();
    await expect(controller.logout(request({ refresh_token: 't' }), response)).resolves.toHaveProperty('message');
    expect(cases.logout.execute).toHaveBeenCalledWith('t');
    expect(mocks(response).clearCookie).toHaveBeenCalled();

    await controller.logout(request(), response);
    expect(cases.logout.execute).toHaveBeenLastCalledWith(undefined);
  });

  it('logout-all revokes every session of the user', async () => {
    const { controller, cases, response } = setup();
    await expect(controller.logoutAll(user, response)).resolves.toHaveProperty('message');
    expect(cases.logoutAll.execute).toHaveBeenCalledWith('u1');
    expect(mocks(response).clearCookie).toHaveBeenCalled();
  });

  describe('refresh cookie options', () => {
    const env = { ...process.env };
    afterEach(() => {
      process.env = { ...env };
    });

    it('uses secure SameSite=None cookies in production by default', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.COOKIE_SECURE;
      delete process.env.COOKIE_SAME_SITE;
      process.env.COOKIE_DOMAIN = 'example.com';
      const { controller, response } = setup();
      await controller.logout(request(), response);
      expect(mocks(response).clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ secure: true, sameSite: 'none', domain: 'example.com' }),
      );
    });

    it.each([['yes', true], ['off', false]])('parses COOKIE_SECURE=%s', async (value, secure) => {
      process.env.COOKIE_SECURE = value;
      process.env.COOKIE_SAME_SITE = 'Strict';
      const { controller, response } = setup();
      await controller.logout(request(), response);
      expect(mocks(response).clearCookie).toHaveBeenCalledWith('refresh_token', expect.objectContaining({ secure, sameSite: 'strict' }));
    });

    it('rejects invalid cookie settings', async () => {
      const { controller, response } = setup();
      process.env.COOKIE_SECURE = 'maybe';
      await expect(controller.logout(request(), response)).rejects.toThrow('COOKIE_SECURE');
      process.env.COOKIE_SECURE = 'true';
      process.env.COOKIE_SAME_SITE = 'sometimes';
      await expect(controller.logout(request(), response)).rejects.toThrow('COOKIE_SAME_SITE');
    });
  });
});
