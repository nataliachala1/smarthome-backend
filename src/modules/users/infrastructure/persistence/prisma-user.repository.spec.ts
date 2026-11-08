/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers such as expect.any() are typed as any. */
jest.mock('../../../../infrastructure/database/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }));

import { UserStatus } from '../../domain/entities/user-status.enum';
import { PrismaUserRepository } from './prisma-user.repository';

const row = {
  id_user: 'u1',
  id_role: 'r1',
  name: 'Ana',
  email: 'ana@example.com',
  password_hash: 'hash',
  status: 'ACTIVE',
  email_verified: true,
  failed_login_attempts: 0,
  locked_until: null,
  last_login_at: null,
  deactivated_at: null,
  session_version: 3,
  created_at: new Date(),
  updated_at: new Date(),
  role: { id_role: 'r1', name: 'USER' },
};

function setup() {
  const user = {
    findFirst: jest.fn().mockResolvedValue(row),
    findUnique: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockResolvedValue(row),
  };
  return { repository: new PrismaUserRepository({ user } as never), user };
}

describe('PrismaUserRepository', () => {
  it('finds users by normalized email and by id, including the global role', async () => {
    const { repository, user } = setup();
    await expect(repository.findByEmail(' Ana@Example.COM ')).resolves.toMatchObject({ id: 'u1', roleName: 'USER' });
    expect(user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'ana@example.com', mode: 'insensitive' } },
      include: { role: true },
    });
    await expect(repository.findById('u1')).resolves.toMatchObject({ email: 'ana@example.com' });

    user.findFirst.mockResolvedValueOnce(null);
    user.findUnique.mockResolvedValueOnce(null);
    await expect(repository.findByEmail('x@example.com')).resolves.toBeNull();
    await expect(repository.findById('missing')).resolves.toBeNull();
  });

  it.each([
    ['activate', () => ['u1'], { status: UserStatus.ACTIVE, email_verified: true, failed_login_attempts: 0, locked_until: null }],
    ['registerSuccessfulLogin', () => ['u1'], { failed_login_attempts: 0, status: UserStatus.ACTIVE, last_login_at: expect.any(Date) }],
    ['updatePassword', () => ['u1', 'new-hash'], { password_hash: 'new-hash', status: UserStatus.ACTIVE }],
    ['reactivate', () => ['u1'], { status: UserStatus.ACTIVE, deactivated_at: null }],
    ['resetExpiredLock', () => ['u1'], { failed_login_attempts: 0, locked_until: null }],
  ] as const)('%s updates the expected columns', async (method, args, data) => {
    const { repository, user } = setup();
    await (repository[method] as (...a: unknown[]) => Promise<unknown>)(...args());
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_user: 'u1' }, data: expect.objectContaining(data) }),
    );
  });

  it('records failed logins and the optional lock', async () => {
    const { repository, user } = setup();
    const lockedUntil = new Date();
    await repository.registerFailedLogin('u1', 5, lockedUntil, UserStatus.LOCKED);
    expect(user.update).toHaveBeenCalledWith({
      where: { id_user: 'u1' },
      data: { failed_login_attempts: 5, locked_until: lockedUntil, status: UserStatus.LOCKED },
    });
  });

  it('trims the profile name and returns the updated user', async () => {
    const { repository, user } = setup();
    await expect(repository.updateProfile('u1', { name: '  Ana B ' })).resolves.toMatchObject({ id: 'u1' });
    expect(user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'Ana B' }) }));
    await repository.updateProfile('u1', {});
    expect(user.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { updated_at: expect.any(Date) } }));
  });

  it('deactivates the account and bumps the session version to revoke JWTs', async () => {
    const { repository, user } = setup();
    user.update.mockResolvedValueOnce({ deactivated_at: null, session_version: 4 });
    const result = await repository.deactivate('u1');
    expect(result.sessionVersion).toBe(4);
    expect(result.deactivatedAt).toBeInstanceOf(Date);
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: UserStatus.DEACTIVATED, session_version: { increment: 1 } }),
      }),
    );
  });

  it('increments the session version', async () => {
    const { repository, user } = setup();
    await repository.incrementSessionVersion('u1');
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_user: 'u1' }, data: expect.objectContaining({ session_version: { increment: 1 } }) }),
    );
  });
});
