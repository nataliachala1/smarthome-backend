jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({ PrismaRlsService: class PrismaRlsService {} }));

import { NotFoundException } from '@nestjs/common';

import { DevicesController } from './devices.controller';

const user = { userId: 'u1', role: 'USER' };
const homeId = 'h1';
const deviceId = 'dev1';

function setup() {
  const make = () => ({ execute: jest.fn().mockResolvedValue({ ok: true }) });
  const cases = {
    list: make(), inactive: make(), create: make(), get: make(), update: make(),
    activate: make(), deactivate: make(), remove: make(), control: make(),
  };
  const controller = new DevicesController(
    ...(Object.values(cases) as unknown as ConstructorParameters<typeof DevicesController>),
  );
  return { controller, cases };
}

describe('DevicesController', () => {
  it('lists active and inactive devices of the home', async () => {
    const { controller, cases } = setup();
    await controller.findAll(user, homeId);
    await controller.findInactive(user, homeId);
    expect(cases.list.execute).toHaveBeenCalledWith('u1', homeId);
    expect(cases.inactive.execute).toHaveBeenCalledWith('u1', homeId);
  });

  it('returns a device or 404', async () => {
    const { controller, cases } = setup();
    await expect(controller.findById(user, homeId, deviceId)).resolves.toEqual({ ok: true });
    cases.get.execute.mockResolvedValueOnce(null);
    await expect(controller.findById(user, homeId, deviceId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates and updates devices with only the allowed fields', async () => {
    const { controller, cases } = setup();
    const dto = { name: 'Lámpara', manufacturerDeviceId: 'shelly-1', transportType: 'WIFI', messagingProtocol: 'MQTT' };
    await controller.create(user, homeId, dto as never);
    expect(cases.create.execute).toHaveBeenCalledWith({ userId: 'u1', homeId, ...dto });

    await controller.update(user, homeId, deviceId, { name: 'Sala', transportType: 'WIFI', messagingProtocol: 'MQTT' } as never);
    expect(cases.update.execute).toHaveBeenCalledWith({
      userId: 'u1', homeId, deviceId, name: 'Sala', transportType: 'WIFI', messagingProtocol: 'MQTT',
    });
  });

  it('changes the lifecycle and controls the device', async () => {
    const { controller, cases } = setup();
    await controller.activate(user, homeId, deviceId);
    await controller.deactivate(user, homeId, deviceId);
    await controller.control(user, homeId, deviceId, { command: 'OFF' } as never);
    await controller.delete(user, homeId, deviceId);
    const ids = { userId: 'u1', homeId, deviceId };
    expect(cases.activate.execute).toHaveBeenCalledWith(ids);
    expect(cases.deactivate.execute).toHaveBeenCalledWith(ids);
    expect(cases.control.execute).toHaveBeenCalledWith({ ...ids, command: 'OFF' });
    expect(cases.remove.execute).toHaveBeenCalledWith(ids);
  });
});
