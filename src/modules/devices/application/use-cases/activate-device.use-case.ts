import { Injectable } from '@nestjs/common';

import { DeviceRepository } from '../../domain/repositories/device.repository';

import { throwDeviceHttpError } from './device-http-error';

export interface ActivateDeviceInput {
  userId: string;
  homeId: string;
  deviceId: string;
}

@Injectable()
export class ActivateDeviceUseCase {
  constructor(
    private readonly deviceRepository:
      DeviceRepository,
  ) {}

  async execute(
    input: ActivateDeviceInput,
  ) {
    const device =
      await this.deviceRepository
        .activate(
          input.userId,
          input.homeId,
          input.deviceId,
        )
        .catch(
          throwDeviceHttpError,
        );

    return {
      id:
        device.id,

      homeId:
        device.homeId,

      deviceTypeId:
        device.deviceTypeId,

      name:
        device.name,

      status:
        device.status,

      connectivityStatus:
        device.connectivityStatus,

      isOn:
        device.isOn,

      currentPowerW:
        device.currentPowerW,

      manufacturerDeviceId:
        device.manufacturerDeviceId,

      transportType:
        device.transportType,

      messagingProtocol:
        device.messagingProtocol,

      createdAt:
        device.createdAt,

      updatedAt:
        device.updatedAt,
    };
  }
}