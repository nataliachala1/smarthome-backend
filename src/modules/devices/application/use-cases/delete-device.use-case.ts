import { Injectable } from '@nestjs/common';

import { DeviceRepository } from '../../domain/repositories/device.repository';

import { throwDeviceHttpError } from './device-http-error';

export interface DeleteDeviceInput {
  userId: string;
  homeId: string;
  deviceId: string;
}

@Injectable()
export class DeleteDeviceUseCase {
  constructor(
    private readonly deviceRepository:
      DeviceRepository,
  ) {}

  async execute(
    input: DeleteDeviceInput,
  ) {
    await this.deviceRepository
      .delete(
        input.userId,
        input.homeId,
        input.deviceId,
      )
      .catch(
        throwDeviceHttpError,
      );

    return {
      message:
        'Dispositivo eliminado correctamente',
    };
  }
}