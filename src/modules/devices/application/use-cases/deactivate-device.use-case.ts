import { Injectable } from '@nestjs/common';
import { throwDeviceHttpError } from './device-http-error';

import { DeviceRepository } from '../../domain/repositories/device.repository';

export interface DeactivateDeviceInput {
  userId: string;
  homeId: string;
  deviceId: string;
}

@Injectable()
export class DeactivateDeviceUseCase {
  constructor(private readonly deviceRepository: DeviceRepository) {}

  async execute(input: DeactivateDeviceInput) {
    const device = await this.deviceRepository
      .deactivate(input.userId, input.homeId, input.deviceId)
      .catch(throwDeviceHttpError);

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
