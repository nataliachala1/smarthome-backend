import { Device } from '../../domain/entities/device.entity';
import { DeviceRepository } from '../../domain/repositories/device.repository';
import { ListHomeDevicesUseCase } from './list-home-devices.use-case';

describe('ListHomeDevicesUseCase permissions', () => {
  const device = new Device({
    id: 'device-1', homeId: 'home-1', name: 'Plug', status: 'ACTIVE',
    connectivityStatus: 'ONLINE', isOn: true, currentPowerW: 42,
    manufacturerDeviceId: 'shelly-1', transportType: 'WIFI',
    messagingProtocol: 'MQTT', createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null,
  });

  it('redacts per-device power when detailed consumption is not authorized', async () => {
    const repository = {
      findAllByHome: jest.fn().mockResolvedValue([device]),
      canReadDetailedConsumption: jest.fn().mockResolvedValue(false),
    } as unknown as DeviceRepository;

    await expect(new ListHomeDevicesUseCase(repository).execute('guest', 'home-1'))
      .resolves.toMatchObject([{ id: 'device-1', currentPowerW: null }]);
  });

  it('returns power only when the effective consumption permission allows that device', async () => {
    const repository = {
      findAllByHome: jest.fn().mockResolvedValue([device]),
      canReadDetailedConsumption: jest.fn().mockResolvedValue(true),
    } as unknown as DeviceRepository;

    await expect(new ListHomeDevicesUseCase(repository).execute('member', 'home-1'))
      .resolves.toMatchObject([{ id: 'device-1', currentPowerW: 42 }]);
  });
});
