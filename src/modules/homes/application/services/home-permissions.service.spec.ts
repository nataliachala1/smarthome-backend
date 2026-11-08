jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class PrismaRlsService {},
}));

import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { HomePermissionsService } from './home-permissions.service';

const owner = [{ allowed: true }];
const notOwner = [{ allowed: false }];
const memberRow = { can_view_devices: true, can_view_consumption: false, can_control_devices: true };
const deviceRow = { can_view_device: true, can_view_consumption: null, can_control_device: false };

/** Each element of `answers` is returned by one $queryRaw call, in order. */
function setup(answers: unknown[][]) {
  const tx = { $queryRaw: jest.fn() };
  answers.forEach((answer) => tx.$queryRaw.mockResolvedValueOnce(answer));
  const prismaRls = { withUserContext: jest.fn((_id: string, op: (t: typeof tx) => unknown) => op(tx)) };
  return { service: new HomePermissionsService(prismaRls as never), tx, prismaRls };
}

describe('HomePermissionsService', () => {
  it('lets only the OWNER read member permissions', async () => {
    const { service, prismaRls } = setup([owner, [memberRow]]);
    await expect(service.getMember('u1', 'h1', 'm1')).resolves.toEqual({
      canViewDevices: true,
      canViewConsumption: false,
      canControlDevices: true,
    });
    expect(prismaRls.withUserContext).toHaveBeenCalledWith('u1', expect.any(Function));

    await expect(setup([notOwner]).service.getMember('u2', 'h1', 'm1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup([owner, []]).service.getMember('u1', 'h1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates member permissions and returns the stored values', async () => {
    const { service, tx } = setup([owner, [{ updated: true }], [memberRow]]);
    const permissions = { canViewDevices: true, canViewConsumption: false, canControlDevices: true };
    await expect(service.setMember('u1', 'h1', 'm1', permissions)).resolves.toEqual(permissions);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);

    await expect(
      setup([owner, [{ updated: false }]]).service.setMember('u1', 'h1', 'm1', permissions),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads per-device permissions', async () => {
    await expect(setup([owner, [deviceRow]]).service.getDevice('u1', 'h1', 'm1', 'd1')).resolves.toEqual({
      canViewDevice: true,
      canViewConsumption: null,
      canControlDevice: false,
    });
    await expect(setup([owner, []]).service.getDevice('u1', 'h1', 'm1', 'd1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps unspecified device permissions and overrides the given ones', async () => {
    const after = { can_view_device: true, can_view_consumption: true, can_control_device: false };
    const { service, tx } = setup([owner, [deviceRow], [{ updated: true }], [after]]);

    await expect(service.setDevice('u1', 'h1', 'm1', 'd1', { canViewConsumption: true })).resolves.toEqual({
      canViewDevice: true,
      canViewConsumption: true,
      canControlDevice: false,
    });
    const setCall = tx.$queryRaw.mock.calls[2] as unknown[];
    expect(setCall.slice(1)).toEqual(['h1', 'm1', 'd1', true, true, false]);
  });

  it('answers 404 when the device permission cannot be read or written', async () => {
    await expect(setup([owner, []]).service.setDevice('u1', 'h1', 'm1', 'd1', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup([owner, [deviceRow], [{ updated: false }]]).service.setDevice('u1', 'h1', 'm1', 'd1', { canControlDevice: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns nulls when the row disappears after the update', async () => {
    const { service } = setup([owner, [deviceRow], [{ updated: true }], []]);
    await expect(service.setDevice('u1', 'h1', 'm1', 'd1', { canViewDevice: false })).resolves.toEqual({
      canViewDevice: null,
      canViewConsumption: null,
      canControlDevice: null,
    });
  });
});
