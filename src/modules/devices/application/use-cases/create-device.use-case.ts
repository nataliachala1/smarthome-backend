import { Injectable } from '@nestjs/common';
import { throwDeviceHttpError } from './device-http-error';

import { DeviceRepository } from '../../domain/repositories/device.repository';

export interface CreateDeviceInput {
  userId: string;
  homeId: string;
  deviceTypeId: string;
  name: string;
  manufacturerDeviceId?: string;
  transportType?: 'WIFI' | 'BLUETOOTH';
  messagingProtocol?: 'MQTT';
}

@Injectable()
export class CreateDeviceUseCase {
  constructor(private readonly deviceRepository: DeviceRepository) {}

  async execute(input: CreateDeviceInput) {
    const device = await this.deviceRepository
      .create(input.userId, {
        homeId: input.homeId,
        deviceTypeId: input.deviceTypeId,
        name: input.name,
        manufacturerDeviceId: input.manufacturerDeviceId ?? null,
        transportType: input.transportType ?? null,
        messagingProtocol: input.messagingProtocol ?? null,
      })
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
