/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers such as expect.any() are typed as any. */
jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class PrismaRlsService {},
}));

import { HomeAccessDeniedError } from '../../domain/errors/home-access-denied.error';
import { HomeHasDevicesError } from '../../domain/errors/home-has-devices.error';
import { PrismaHomeRepository } from './prisma-home.repository';

const homeRow = {
  id_home: 'h1',
  created_by: 'u1',
  name: 'Casa',
  status: 'ACTIVE',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
  deleted_at: null,
};

function setup() {
  const tx = {
    home_member: {
      findMany: jest.fn().mockResolvedValue([{ id_home: 'h1' }]),
      findFirst: jest.fn().mockResolvedValue({ id_home_member: 'm1' }),
      create: jest.fn().mockResolvedValue({}),
    },
    home: {
      findMany: jest.fn().mockResolvedValue([homeRow]),
      findFirst: jest.fn().mockResolvedValue(homeRow),
      update: jest.fn().mockResolvedValue({ ...homeRow, name: 'Nueva' }),
      create: jest.fn().mockResolvedValue(homeRow),
    },
    device: { count: jest.fn().mockResolvedValue(0) },
  };
  const prismaRls = { withUserContext: jest.fn((_id: string, op: (t: typeof tx) => unknown) => op(tx)) };
  return { repository: new PrismaHomeRepository(prismaRls as never), tx, prismaRls };
}

const accessDenied = () =>
  Object.assign(new Error('permission denied for table home'), {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode: '42501' } } },
  });

describe('PrismaHomeRepository', () => {
  it('lists only the active homes where the user has an active membership', async () => {
    const { repository, tx, prismaRls } = setup();
    const homes = await repository.findAllByUser('u1');

    expect(prismaRls.withUserContext).toHaveBeenCalledWith('u1', expect.any(Function));
    expect(tx.home_member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_user: 'u1', status: 'ACTIVE' } }),
    );
    expect(tx.home.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_home: { in: ['h1'] }, status: 'ACTIVE', deleted_at: null } }),
    );
    expect(homes.map((home) => home.name)).toEqual(['Casa']);
  });

  it('returns an empty list without querying homes when there are no memberships', async () => {
    const { repository, tx } = setup();
    tx.home_member.findMany.mockResolvedValueOnce([]);
    await expect(repository.findAllByUser('u1')).resolves.toEqual([]);
    expect(tx.home.findMany).not.toHaveBeenCalled();
  });

  it('finds a visible home or returns null', async () => {
    const { repository, tx } = setup();
    await expect(repository.findById('u1', 'h1')).resolves.toMatchObject({ id: 'h1', name: 'Casa' });
    tx.home.findFirst.mockResolvedValueOnce(null);
    await expect(repository.findById('u1', 'h1')).resolves.toBeNull();
  });

  it('creates the home together with its OWNER membership', async () => {
    const { repository, tx } = setup();
    await expect(repository.create({ userId: 'u1', name: 'Casa' })).resolves.toMatchObject({ id: 'h1' });
    expect(tx.home.create).toHaveBeenCalledWith({ data: { created_by: 'u1', name: 'Casa', status: 'ACTIVE' } });
    expect(tx.home_member.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_home: 'h1', id_user: 'u1', role: 'OWNER', status: 'ACTIVE' }),
    });
  });

  describe('update', () => {
    it('updates only the provided fields', async () => {
      const { repository, tx } = setup();
      await expect(repository.update({ userId: 'u1', homeId: 'h1', name: 'Nueva' })).resolves.toMatchObject({ name: 'Nueva' });
      expect(tx.home.update).toHaveBeenCalledWith({ where: { id_home: 'h1' }, data: { name: 'Nueva' } });
    });

    it.each([
      ['an RLS denial', accessDenied()],
      ['a missing row', Object.assign(new Error('not found'), { code: 'P2025' })],
    ])('translates %s into HomeAccessDeniedError', async (_label, error) => {
      const { repository, tx } = setup();
      tx.home.update.mockRejectedValueOnce(error);
      await expect(repository.update({ userId: 'u1', homeId: 'h1', name: 'x' })).rejects.toBeInstanceOf(HomeAccessDeniedError);
    });

    it('rethrows unexpected errors', async () => {
      const { repository, tx } = setup();
      tx.home.update.mockRejectedValueOnce(new Error('connection lost'));
      await expect(repository.update({ userId: 'u1', homeId: 'h1', name: 'x' })).rejects.toThrow('connection lost');
    });
  });

  describe('deleteIfNoDevices', () => {
    it('soft-deletes an empty home owned by the caller', async () => {
      const { repository, tx } = setup();
      await repository.deleteIfNoDevices('u1', 'h1');
      expect(tx.home.update).toHaveBeenCalledWith({
        where: { id_home: 'h1' },
        data: { deleted_at: expect.any(Date), status: 'DEACTIVATED' },
      });
    });

    it('refuses callers that are not the active OWNER', async () => {
      const { repository, tx } = setup();
      tx.home_member.findFirst.mockResolvedValueOnce(null);
      await expect(repository.deleteIfNoDevices('u2', 'h1')).rejects.toBeInstanceOf(HomeAccessDeniedError);
      expect(tx.home.update).not.toHaveBeenCalled();
    });

    it('refuses homes that still have devices', async () => {
      const { repository, tx } = setup();
      tx.device.count.mockResolvedValueOnce(2);
      await expect(repository.deleteIfNoDevices('u1', 'h1')).rejects.toBeInstanceOf(HomeHasDevicesError);
      expect(tx.home.update).not.toHaveBeenCalled();
    });

    it.each([accessDenied(), Object.assign(new Error('gone'), { code: 'P2025' })])(
      'translates database denials (%p)',
      async (error) => {
        const { repository, tx } = setup();
        tx.home.update.mockRejectedValueOnce(error);
        await expect(repository.deleteIfNoDevices('u1', 'h1')).rejects.toBeInstanceOf(HomeAccessDeniedError);
      },
    );

    it('rethrows unexpected errors', async () => {
      const { repository, tx } = setup();
      tx.device.count.mockRejectedValueOnce(new Error('timeout'));
      await expect(repository.deleteIfNoDevices('u1', 'h1')).rejects.toThrow('timeout');
    });
  });
});
