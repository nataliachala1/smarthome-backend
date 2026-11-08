/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers such as expect.any() are typed as any. */
jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class PrismaRlsService {},
}));

import { PrismaHomeMemberRepository } from './prisma-home-member.repository';

const member = (overrides: Record<string, unknown> = {}) => ({
  id_home_member: 'm1',
  id_home: 'h1',
  id_user: 'u2',
  role: 'MEMBER',
  status: 'PENDING',
  invited_by: 'u1',
  invited_at: new Date(),
  accepted_at: null,
  ended_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

function setup() {
  const table = {
    findMany: jest.fn().mockResolvedValue([member()]),
    findFirst: jest.fn().mockResolvedValue(member({ status: 'ACTIVE' })),
    update: jest.fn().mockResolvedValue(member({ status: 'ACTIVE' })),
    create: jest.fn().mockResolvedValue(member()),
  };
  const tx = { home_member: table };
  const prismaRls = { withUserContext: jest.fn((_id: string, op: (t: typeof tx) => unknown) => op(tx)) };
  return { repository: new PrismaHomeMemberRepository(prismaRls as never), table, prismaRls };
}

describe('PrismaHomeMemberRepository', () => {
  it('lists the members of a home and the pending invitations of a user', async () => {
    const { repository, table, prismaRls } = setup();
    await expect(repository.findAllByHome('u1', 'h1')).resolves.toHaveLength(1);
    expect(table.findMany).toHaveBeenCalledWith({ where: { id_home: 'h1' }, orderBy: { created_at: 'asc' } });
    await expect(repository.findPendingByUser('u2')).resolves.toHaveLength(1);
    expect(table.findMany).toHaveBeenLastCalledWith({ where: { id_user: 'u2', status: 'PENDING' }, orderBy: { invited_at: 'desc' } });
    expect(prismaRls.withUserContext).toHaveBeenCalledWith('u2', expect.any(Function));
  });

  it('finds only the caller own membership', async () => {
    const { repository, table } = setup();
    await expect(repository.findByIdForUser('u2', 'm1')).resolves.toMatchObject({ id: 'm1' });
    expect(table.findFirst).toHaveBeenCalledWith({ where: { id_home_member: 'm1', id_user: 'u2' } });
    table.findFirst.mockResolvedValueOnce(null);
    await expect(repository.findByIdForUser('u2', 'm9')).resolves.toBeNull();
  });

  it('accepts and rejects invitations', async () => {
    const { repository, table } = setup();
    await repository.acceptInvitation('u2', 'm1');
    expect(table.update).toHaveBeenCalledWith({
      where: { id_home_member: 'm1' },
      data: { status: 'ACTIVE', accepted_at: expect.any(Date), ended_at: null },
    });
    await repository.rejectInvitation('u2', 'm1');
    expect(table.update).toHaveBeenLastCalledWith({
      where: { id_home_member: 'm1' },
      data: { status: 'LEFT', accepted_at: null, ended_at: expect.any(Date) },
    });
  });

  it('lets a MEMBER or GUEST leave an active membership', async () => {
    const { repository, table } = setup();
    await repository.leaveHome('u2', 'h1');
    expect(table.update).toHaveBeenCalledWith({
      where: { id_home_member: 'm1' },
      data: { status: 'LEFT', ended_at: expect.any(Date) },
    });
    table.findFirst.mockResolvedValueOnce(null);
    await expect(repository.leaveHome('u2', 'h1')).rejects.toThrow('ACTIVE_MEMBERSHIP_NOT_FOUND');
  });

  it('changes a member role and revokes memberships', async () => {
    const { repository, table } = setup();
    await repository.updateRole('u1', 'h1', 'm1', 'GUEST');
    expect(table.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'GUEST' }) }));

    await repository.revoke('u1', 'h1', 'm1');
    expect(table.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REVOKED' }) }));

    table.findFirst.mockResolvedValueOnce(null);
    await expect(repository.revoke('u1', 'h1', 'm1')).rejects.toThrow('MEMBERSHIP_NOT_REVOCABLE');
  });

  it('creates PENDING invitations', async () => {
    const { repository, table } = setup();
    await repository.createInvitation({ userId: 'u1', homeId: 'h1', invitedUserId: 'u2', role: 'MEMBER' } as never);
    expect(table.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'MEMBER', status: 'PENDING' }) }),
    );
  });
});
