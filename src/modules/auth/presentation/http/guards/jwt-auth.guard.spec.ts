jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { makeUser } from '../../../../../test-support/auth-fixtures';
import { UserStatus } from '../../../../users/domain/entities/user-status.enum';
import { JwtAuthGuard } from './jwt-auth.guard';

const userId = 'd0000000-0000-4000-8000-000000000002';
const sessionId = 'f0000000-0000-4000-8000-000000000001';

function payload(overrides: Record<string, unknown> = {}) {
  return { sub: userId, role: 'USER', sv: 3, sid: sessionId, exp: Math.floor(Date.now() / 1000) + 600, ...overrides };
}

function setup(options: { verify?: unknown; user?: unknown; activeFamily?: boolean } = {}) {
  const jwt = {
    verifyAsync: jest.fn(() =>
      options.verify instanceof Error ? Promise.reject(options.verify) : Promise.resolve(options.verify ?? payload()),
    ),
  };
  const users = { findById: jest.fn().mockResolvedValue(options.user === undefined ? makeUser({ id: userId }) : options.user) };
  const refreshTokens = { hasActiveFamily: jest.fn().mockResolvedValue(options.activeFamily ?? true) };
  const guard = new JwtAuthGuard(jwt as never, users as never, refreshTokens as never);
  return { guard, jwt, refreshTokens };
}

function context(authorization?: string) {
  const request: { headers: Record<string, string>; user?: unknown } = {
    headers: authorization ? { authorization } : {},
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('JwtAuthGuard', () => {
  it('accepts a valid HS256 token with an active session and attaches the user', async () => {
    const { guard, jwt, refreshTokens } = setup();
    const { ctx, request } = context('Bearer good.token');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('good.token', { algorithms: ['HS256'] });
    expect(refreshTokens.hasActiveFamily).toHaveBeenCalledWith(userId, sessionId, 3);
    expect(request.user).toEqual({ userId, role: 'USER' });
  });

  it.each([undefined, 'Basic abc', 'Bearer'])('rejects a missing or non-Bearer header (%p)', async (header) => {
    await expect(setup().guard.canActivate(context(header).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token with an invalid signature', async () => {
    const { guard } = setup({ verify: new Error('invalid signature') });
    await expect(guard.canActivate(context('Bearer forged').ctx)).rejects.toThrow(UnauthorizedException);
  });

  it.each([
    ['a non-UUID subject', { sub: 'admin' }],
    ['an empty role', { role: '' }],
    ['a negative session version', { sv: -1 }],
    ['a non-UUID session id', { sid: 'abc' }],
    ['a missing expiry', { exp: undefined }],
  ])('rejects a payload with %s', async (_label, overrides) => {
    const { guard } = setup({ verify: payload(overrides) });
    await expect(guard.canActivate(context('Bearer t').ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['the user no longer exists', { user: null }],
    ['the account is not active', { user: makeUser({ id: userId, status: UserStatus.LOCKED, lockedUntil: new Date() }) }],
    ['the session version changed', { user: makeUser({ id: userId, sessionVersion: 4 }) }],
    ['the global role changed', { user: makeUser({ id: userId, roleName: 'SYSTEM_ADMIN' }) }],
    ['the session family was revoked', { activeFamily: false }],
    ['the token is expired', { verify: payload({ exp: Math.floor(Date.now() / 1000) - 1 }) }],
  ])('rejects the request when %s', async (_label, options) => {
    const { guard } = setup(options);
    const { ctx, request } = context('Bearer t');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });
});
