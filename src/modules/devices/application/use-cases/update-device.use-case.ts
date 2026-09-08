import { Injectable } from '@nestjs/common';
import { throwDeviceHttpError } from './device-http-error';

import { DeviceRepository } from '../../domain/repositories/device.repository';

export interface UpdateDeviceInput {
  userId: string;
  homeId: string;
  deviceId: string;
  deviceTypeId?: string;
  name?: string;
  transportType?: 'WIFI' | 'BLUETOOTH';
  messagingProtocol?: 'MQTT';
}

@Injectable()
export class UpdateDeviceUseCase {
  constructor(private readonly deviceRepository: DeviceRepository) {}

  async execute(input: UpdateDeviceInput) {
    const device = await this.deviceRepository
      .update(input.userId, input.homeId, input.deviceId, {
        deviceTypeId: input.deviceTypeId,
        name: input.name,
        transportType: input.transportType ?? undefined,
        messagingProtocol: input.messagingProtocol ?? undefined,
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
