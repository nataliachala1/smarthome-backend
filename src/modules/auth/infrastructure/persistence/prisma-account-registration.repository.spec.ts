jest.mock('../../../../infrastructure/database/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaAccountRegistrationRepository } from './prisma-account-registration.repository';

describe('PrismaAccountRegistrationRepository', () => {
  const data = {
    name: 'Ana',
    email: 'ana@example.com',
    passwordHash: 'hash',
    activationTokenHash: 'token-hash',
    activationTokenExpiresAt: new Date('2026-11-07T12:00:00Z'),
  };

  function setup() {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id_user: 'u1', name: 'Ana', email: 'ana@example.com', status: 'PENDING', email_verified: false },
      ]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown, options: unknown) => {
        void options;
        return Promise.resolve(callback(tx));
      }),
    };
    return { repository: new PrismaAccountRegistrationRepository(prisma as never), prisma, tx };
  }

  it('inserts the user and token in one transaction and runs the callback before commit', async () => {
    const { repository, prisma, tx } = setup();
    const beforeCommit = jest.fn().mockResolvedValue(undefined);

    const user = await repository.registerPendingUser(data, beforeCommit);

    expect(user).toEqual({ id: 'u1', name: 'Ana', email: 'ana@example.com', status: 'PENDING', emailVerified: false });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(beforeCommit).toHaveBeenCalledWith(user);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20_000 });
  });

  it('propagates callback failures so the transaction rolls back', async () => {
    const { repository } = setup();
    await expect(
      repository.registerPendingUser(data, () => Promise.reject(new Error('smtp down'))),
    ).rejects.toThrow('smtp down');
  });
});
