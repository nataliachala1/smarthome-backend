jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { ConflictException, NotFoundException } from '@nestjs/common';

import { HomeAccessDeniedError } from '../../domain/errors/home-access-denied.error';
import { HomeHasDevicesError } from '../../domain/errors/home-has-devices.error';
import { HomesController } from './homes.controller';

const user = { userId: 'u1', role: 'USER' };
const homeId = 'd1000000-0000-4000-8000-000000000001';
const memberId = 'd2000000-0000-4000-8000-000000000002';

function setup() {
  const make = () => ({ execute: jest.fn().mockResolvedValue({ result: true }) });
  const cases = {
    list: make(), create: make(), get: make(), update: make(), members: make(),
    invite: make(), leave: make(), role: make(), revoke: make(), remove: make(),
  };
  const controller = new HomesController(
    ...(Object.values(cases) as unknown as ConstructorParameters<typeof HomesController>),
  );
  return { controller, cases };
}

describe('HomesController', () => {
  it('lists, creates, reads and updates homes for the caller', async () => {
    const { controller, cases } = setup();
    await expect(controller.findAll(user)).resolves.toEqual({ result: true });
    expect(cases.list.execute).toHaveBeenCalledWith({ userId: 'u1' });

    await controller.create(user, { name: 'Casa' });
    expect(cases.create.execute).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));

    await controller.findById(user, homeId);
    expect(cases.get.execute).toHaveBeenCalledWith({ userId: 'u1', homeId });

    await controller.update(user, homeId, { name: 'Nueva' });
    expect(cases.update.execute).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', homeId }));
  });

  it('answers 404 when the home is not visible to the caller', async () => {
    const { controller, cases } = setup();
    cases.get.execute.mockResolvedValueOnce(null);
    await expect(controller.findById(user, homeId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('manages members and invitations', async () => {
    const { controller, cases } = setup();
    await controller.listMembers(user, homeId);
    expect(cases.members.execute).toHaveBeenCalledWith({ userId: 'u1', homeId });

    await controller.createInvitation(user, homeId, { email: 'b@example.com', role: 'MEMBER' } as never);
    expect(cases.invite.execute).toHaveBeenCalledWith({ userId: 'u1', homeId, email: 'b@example.com', role: 'MEMBER' });

    await controller.updateMemberRole(user, homeId, memberId, { role: 'GUEST' } as never);
    expect(cases.role.execute).toHaveBeenCalledWith({ userId: 'u1', homeId, memberId, role: 'GUEST' });

    await controller.revokeMember(user, homeId, memberId);
    expect(cases.revoke.execute).toHaveBeenCalledWith('u1', homeId, memberId);

    await controller.leaveHome(user, homeId);
    expect(cases.leave.execute).toHaveBeenCalledWith('u1', homeId);
  });

  describe('delete', () => {
    it('deletes an empty home', async () => {
      const { controller, cases } = setup();
      await expect(controller.delete(user, homeId)).resolves.toEqual({ result: true });
      expect(cases.remove.execute).toHaveBeenCalledWith({ userId: 'u1', homeId });
    });

    it('answers 409 while the home still has devices', async () => {
      const { controller, cases } = setup();
      cases.remove.execute.mockRejectedValueOnce(new HomeHasDevicesError());
      await expect(controller.delete(user, homeId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('hides homes the caller cannot manage behind a 404', async () => {
      const { controller, cases } = setup();
      cases.remove.execute.mockRejectedValueOnce(new HomeAccessDeniedError());
      await expect(controller.delete(user, homeId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rethrows unexpected errors', async () => {
      const { controller, cases } = setup();
      cases.remove.execute.mockRejectedValueOnce(new Error('db'));
      await expect(controller.delete(user, homeId)).rejects.toThrow('db');
    });
  });
});
