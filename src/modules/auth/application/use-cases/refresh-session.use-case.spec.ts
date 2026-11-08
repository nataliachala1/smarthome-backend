jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('../../../../security/session-revocation.module', () => ({
  SessionRevocationService: class SessionRevocationService {},
}));

import { makeUser, mockOf } from '../../../../test-support/auth-fixtures';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';
import { InvalidRefreshTokenError } from '../../domain/errors/invalid-refresh-token.error';
import { RefreshSessionUseCase } from './refresh-session.use-case';

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  userId: 'u1',
  familyId: 'f1',
  sessionVersion: 3,
  isRevoked: false,
  isExpired: false,
  ...overrides,
});

function setup(token: unknown = stored(), user = makeUser()) {
  const refreshTokens = mockOf('findByHash', 'revokeFamily', 'revoke', 'rotate');
  refreshTokens.findByHash.mockResolvedValue(token);
  refreshTokens.rotate.mockResolvedValue(true);
  const users = mockOf('findById');
  users.findById.mockResolvedValue(user);
  const secure = { generate: jest.fn().mockReturnValue('new-raw'), hash: jest.fn((v: string) => `hash(${v})`) };
  const tokens = { generateAccessToken: jest.fn().mockResolvedValue('jwt-2') };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const revocations = { revokeFamily: jest.fn() };
  const useCase = new RefreshSessionUseCase(
    refreshTokens as never,
    users as never,
    secure,
    tokens,
    config as never,
    revocations as never,
  );
  return { useCase, refreshTokens, revocations, users };
}

describe('RefreshSessionUseCase', () => {
  it('rotates the token inside the same family and issues a new access token', async () => {
    const { useCase, refreshTokens } = setup();
    const result = await useCase.execute('old-raw');

    expect(refreshTokens.findByHash).toHaveBeenCalledWith('hash(old-raw)');
    expect(refreshTokens.rotate).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ familyId: 'f1', tokenHash: 'hash(new-raw)', sessionVersion: 3 }),
    );
    expect(result).toMatchObject({ accessToken: 'jwt-2', tokenType: 'Bearer', refreshToken: 'new-raw' });
    expect(Math.round((result.refreshTokenExpiresAt.getTime() - Date.now()) / 86_400_000)).toBe(30);
  });

  it('rejects an empty or unknown token', async () => {
    await expect(setup().useCase.execute('')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    await expect(setup(null).useCase.execute('x')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('revokes the whole family when a revoked token is reused', async () => {
    const { useCase, refreshTokens, revocations } = setup(stored({ isRevoked: true }));
    await expect(useCase.execute('x')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    expect(refreshTokens.revokeFamily).toHaveBeenCalledWith('f1');
    expect(revocations.revokeFamily).toHaveBeenCalledWith('u1', 'f1');
  });

  it('revokes only the expired token', async () => {
    const { useCase, refreshTokens } = setup(stored({ isExpired: true }));
    await expect(useCase.execute('x')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    expect(refreshTokens.revoke).toHaveBeenCalledWith('t1');
    expect(refreshTokens.revokeFamily).not.toHaveBeenCalled();
  });

  it('rejects a token whose user no longer exists', async () => {
    const { useCase, users } = setup();
    users.findById.mockResolvedValue(null);
    await expect(useCase.execute('x')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it.each([
    ['an inactive account', setup(stored(), makeUser({ status: UserStatus.DEACTIVATED, deactivatedAt: new Date() }))],
    ['a revoked session version', setup(stored({ sessionVersion: 2 }))],
  ])('revokes the family for %s', async (_label, context) => {
    await expect(context.useCase.execute('x')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    expect(context.refreshTokens.revokeFamily).toHaveBeenCalledWith('f1');
    expect(context.refreshTokens.rotate).not.toHaveBeenCalled();
  });

  it('revokes the family when a concurrent rotation already won', async () => {
    const { useCase, refreshTokens, revocations } = setup();
    refreshTokens.rotate.mockResolvedValue(false);
    await expect(useCase.execute('x')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    expect(revocations.revokeFamily).toHaveBeenCalledWith('u1', 'f1');
  });
});
