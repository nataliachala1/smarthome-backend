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

    return devices.map((device) => ({
      id: device.id,
      homeId: device.homeId,
      deviceTypeId: device.deviceTypeId,
      name: device.name,
      status: device.status,
      connectivityStatus: device.connectivityStatus,
      isOn: device.isOn,
      currentPowerW: device.currentPowerW,
      manufacturerDeviceId: device.manufacturerDeviceId,
      transportType: device.transportType,
      messagingProtocol: device.messagingProtocol,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    }));
  }
}
