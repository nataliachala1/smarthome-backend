jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { makeUser, mockOf } from '../../../../test-support/auth-fixtures';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';
import { AccountLockedError } from '../../domain/errors/account-locked.error';
import { AccountNotActiveError } from '../../domain/errors/account-not-active.error';
import { InvalidCredentialsError } from '../../domain/errors/invalid-credentials.error';
import { LoginUserUseCase } from './login-user.use-case';

function setup(user = makeUser(), passwordOk = true) {
  const users = mockOf('findByEmail', 'resetExpiredLock', 'registerFailedLogin', 'registerSuccessfulLogin');
  users.findByEmail.mockResolvedValue(user);
  const hasher = { verify: jest.fn().mockResolvedValue(passwordOk), hash: jest.fn() };
  const tokens = { generateAccessToken: jest.fn().mockResolvedValue('jwt') };
  const secure = { generate: jest.fn().mockReturnValue('raw-refresh'), hash: jest.fn().mockReturnValue('refresh-hash') };
  const refreshTokens = mockOf('create');
  const config = { get: jest.fn().mockReturnValue('7') };
  const useCase = new LoginUserUseCase(
    users as never,
    hasher,
    tokens,
    secure,
    refreshTokens as never,
    config as never,
  );
  return { useCase, users, hasher, tokens, refreshTokens };
}

const input = { email: ' Ana@Example.com ', password: 'SmartHome#2026' };

describe('LoginUserUseCase', () => {
  it('issues an access token and a 7-day refresh session for valid credentials', async () => {
    const { useCase, users, tokens, refreshTokens } = setup();
    const before = Date.now();

    const result = await useCase.execute(input);

    expect(users.findByEmail).toHaveBeenCalledWith('ana@example.com');
    expect(users.registerSuccessfulLogin).toHaveBeenCalledWith('u1');
    expect(result).toMatchObject({
      accessToken: 'jwt',
      tokenType: 'Bearer',
      refreshToken: 'raw-refresh',
      user: { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'USER' },
    });
    const days = (result.refreshTokenExpiresAt.getTime() - before) / 86_400_000;
    expect(Math.round(days)).toBe(7);
    const [session] = refreshTokens.create.mock.calls[0] as [{ familyId: string; tokenHash: string; sessionVersion: number }];
    expect(session).toMatchObject({ userId: 'u1', tokenHash: 'refresh-hash', sessionVersion: 3 });
    expect(tokens.generateAccessToken).toHaveBeenCalledWith({
      userId: 'u1',
      globalRole: 'USER',
      sessionVersion: 3,
      sessionId: session.familyId,
    });
  });

  it('rejects an unknown email with a generic error', async () => {
    const { useCase, users } = setup();
    users.findByEmail.mockResolvedValue(null);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it.each([UserStatus.PENDING, UserStatus.DEACTIVATED])('rejects a %s account', async (status) => {
    const { useCase, hasher } = setup(makeUser({ status }));
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(AccountNotActiveError);
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it('keeps a locked account locked until the lock expires', async () => {
    const lockedUntil = new Date(Date.now() + 60_000);
    const { useCase, hasher } = setup(makeUser({ status: UserStatus.LOCKED, lockedUntil }));
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(AccountLockedError);
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it('resets an expired lock before checking the password', async () => {
    const user = makeUser({ status: UserStatus.LOCKED, lockedUntil: new Date(Date.now() - 1000), failedLoginAttempts: 5 });
    const { useCase, users } = setup(user, false);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(users.resetExpiredLock).toHaveBeenCalledWith('u1');
    expect(users.registerFailedLogin).toHaveBeenCalledWith('u1', 1, null, UserStatus.ACTIVE);
  });

  it('counts a wrong password as a failed attempt', async () => {
    const { useCase, users, refreshTokens } = setup(makeUser({ failedLoginAttempts: 2 }), false);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(users.registerFailedLogin).toHaveBeenCalledWith('u1', 3, null, UserStatus.ACTIVE);
    expect(refreshTokens.create).not.toHaveBeenCalled();
  });

  it('locks the account for 15 minutes on the fifth failed attempt', async () => {
    const { useCase, users } = setup(makeUser({ failedLoginAttempts: 4 }), false);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(AccountLockedError);
    const [, attempts, lockedUntil, status] = users.registerFailedLogin.mock.calls[0] as [string, number, Date, UserStatus];
    expect(attempts).toBe(5);
    expect(status).toBe(UserStatus.LOCKED);
    expect(lockedUntil.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
  });
});
