import { Injectable } from '@nestjs/common';
import { throwDeviceHttpError } from './device-http-error';

import { DeviceRepository } from '../../domain/repositories/device.repository';

@Injectable()
export class ListHomeDevicesUseCase {
  constructor(private readonly deviceRepository: DeviceRepository) {}

  async execute(userId: string, homeId: string) {
    const devices = await this.deviceRepository
      .findAllByHome(userId, homeId)
      .catch(throwDeviceHttpError);
    return Promise.all(devices.map(async (device) => ({
      id: device.id,
      homeId: device.homeId,
      name: device.name,
      status: device.status,
      connectivityStatus: device.connectivityStatus,
      isOn: device.isOn,
      currentPowerW: await this.deviceRepository.canReadDetailedConsumption(userId, device.id) ? device.currentPowerW : null,
      manufacturerDeviceId: device.manufacturerDeviceId,
      transportType: device.transportType,
      messagingProtocol: device.messagingProtocol,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    })));
  }
}
