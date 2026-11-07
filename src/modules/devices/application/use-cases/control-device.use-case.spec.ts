import { ConflictException } from '@nestjs/common';

import { ControlDeviceUseCase } from './control-device.use-case';

const device = (overrides: Record<string, unknown> = {}) => ({
  id: 'dev1',
  homeId: 'h1',
  status: 'ACTIVE',
  deletedAt: null,
  connectivityStatus: 'ONLINE',
  manufacturerDeviceId: 'shelly1pmg4-abc',
  messagingProtocol: 'MQTT',
  ...overrides,
});

function setup(found: unknown = device(), canView = true) {
  const repository = {
    findForControl: jest.fn().mockResolvedValue(found),
    canViewDevice: jest.fn().mockResolvedValue(canView),
  };
  const publisher = { publishControlCommand: jest.fn().mockResolvedValue(undefined) };
  return { useCase: new ControlDeviceUseCase(repository as never, publisher), repository, publisher };
}

const input = { userId: 'u1', homeId: 'h1', deviceId: 'dev1', command: 'ON' as const };

describe('ControlDeviceUseCase', () => {
  it('publishes the command for an online MQTT device', async () => {
    const { useCase, publisher } = setup();
    await expect(useCase.execute(input)).resolves.toEqual({ id: 'dev1', command: 'ON', status: 'COMMAND_PUBLISHED' });
    expect(publisher.publishControlCommand).toHaveBeenCalledWith({
      homeId: 'h1',
      deviceId: 'dev1',
      manufacturerDeviceId: 'shelly1pmg4-abc',
      action: 'ON',
    });
  });

  it.each([
    ['a device the caller cannot control', null, true],
    ['a deactivated device', device({ status: 'DEACTIVATED' }), true],
    ['a deleted device', device({ deletedAt: new Date() }), true],
    ['an offline device', device({ connectivityStatus: 'OFFLINE' }), true],
    ['an offline device the caller cannot even see', device({ connectivityStatus: 'OFFLINE' }), false],
    ['a device without MQTT identity', device({ manufacturerDeviceId: null }), true],
    ['a device without MQTT protocol, hidden from the caller', device({ messagingProtocol: null }), false],
  ])('answers 409 for %s and never publishes', async (_label, found, canView) => {
    const { useCase, publisher } = setup(found, canView);
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictException);
    expect(publisher.publishControlCommand).not.toHaveBeenCalled();
  });
});
