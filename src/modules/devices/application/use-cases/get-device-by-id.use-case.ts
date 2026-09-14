import { Injectable } from '@nestjs/common';
import { throwDeviceHttpError } from './device-http-error';

import { DeviceRepository } from '../../domain/repositories/device.repository';

@Injectable()
export class GetDeviceByIdUseCase {
  constructor(private readonly deviceRepository: DeviceRepository) {}

  async execute(userId: string, homeId: string, deviceId: string) {
    const device = await this.deviceRepository
      .findById(userId, homeId, deviceId)
      .catch(throwDeviceHttpError);

    if (!device) {
      return null;
    }

    return {
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
    };
  }
}
