/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers such as expect.any() are typed as any. */
jest.mock('../../../../infrastructure/database/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }));

import { PrismaRefreshTokenRepository } from './prisma-refresh-token.repository';

const future = new Date(Date.now() + 86_400_000);
const raw = (overrides: Record<string, unknown> = {}) => ({
  id_refresh_token: 't1',
  id_user: 'u1',
  token_hash: 'hash',
  family_id: 'f1',
  session_version: 3,
  expires_at: future,
  revoked_at: null,
  replaced_by_token_hash: null,
  last_used_at: null,
  created_at: new Date(),
  ...overrides,
});

function setup(previous: unknown = raw()) {
  const table = {
    findFirst: jest.fn().mockResolvedValue({ id_refresh_token: 't1' }),
    findUnique: jest.fn().mockResolvedValue(previous),
    create: jest.fn().mockResolvedValue(raw({ id_refresh_token: 't2' })),
    update: jest.fn().mockResolvedValue(raw()),
    updateMany: jest.fn().mockResolvedValue({ count: 2 }),
  };
  const tx = { refresh_token: table, $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = {
    refresh_token: table,
    $transaction: jest.fn((op: (t: typeof tx) => unknown) => op(tx)),
  };
  return { repository: new PrismaRefreshTokenRepository(prisma as never), table, tx, prisma };
}

const next = { userId: 'u1', tokenHash: 'new-hash', familyId: 'f1', sessionVersion: 3, expiresAt: future };

describe('PrismaRefreshTokenRepository', () => {
  it('checks for an active, unexpired family of the current session version', async () => {
    const { repository, table } = setup();
    await expect(repository.hasActiveFamily('u1', 'f1', 3)).resolves.toBe(true);
    expect(table.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id_user: 'u1', family_id: 'f1', session_version: 3, revoked_at: null }),
      }),
    );
    table.findFirst.mockResolvedValueOnce(null);
    await expect(repository.hasActiveFamily('u1', 'f1', 3)).resolves.toBe(false);
  });

  it('rotates under a family lock: creates the new token and revokes the previous one', async () => {
    const { repository, table, tx, prisma } = setup();
    await expect(repository.rotate('t1', next)).resolves.toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(table.create).toHaveBeenCalledWith({
      data: { id_user: 'u1', token_hash: 'new-hash', family_id: 'f1', session_version: 3, expires_at: future },
    });
    expect(table.update).toHaveBeenCalledWith({
      where: { id_refresh_token: 't1' },
      data: expect.objectContaining({ revoked_at: expect.any(Date), replaced_by_token_hash: 'new-hash' }),
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
  });

  it.each([
    ['a missing token', null],
    ['another family', raw({ family_id: 'f2' })],
    ['another user', raw({ id_user: 'u2' })],
    ['an older session version', raw({ session_version: 2 })],
    ['an already revoked token', raw({ revoked_at: new Date() })],
    ['an expired token', raw({ expires_at: new Date(Date.now() - 1000) })],
  ])('refuses to rotate %s', async (_label, previous) => {
    const { repository, table } = setup(previous);
    await expect(repository.rotate('t1', next)).resolves.toBe(false);
    expect(table.create).not.toHaveBeenCalled();
  });

  it('creates and finds tokens through the mapper', async () => {
    const { repository, table } = setup();
    await expect(repository.create(next)).resolves.toMatchObject({ id: 't2', familyId: 'f1' });
    await expect(repository.findByHash('hash')).resolves.toMatchObject({ id: 't1', userId: 'u1' });
    table.findUnique.mockResolvedValueOnce(null);
    await expect(repository.findByHash('nope')).resolves.toBeNull();
  });

  it('revokes one token, a family and every token of a user', async () => {
    const { repository, table } = setup();
    await repository.revoke('t1', 'replacement');
    expect(table.update).toHaveBeenCalledWith({
      where: { id_refresh_token: 't1' },
      data: { revoked_at: expect.any(Date), replaced_by_token_hash: 'replacement' },
    });

    await repository.revokeFamily('f1');
    expect(table.updateMany).toHaveBeenCalledWith({ where: { family_id: 'f1', revoked_at: null }, data: { revoked_at: expect.any(Date) } });

    await repository.revokeAllByUser('u1');
    expect(table.updateMany).toHaveBeenCalledWith({ where: { id_user: 'u1', revoked_at: null }, data: { revoked_at: expect.any(Date) } });

    await repository.markAsUsed('t1');
    expect(table.update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id_refresh_token: 't1' } }));
  });
});
