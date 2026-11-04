import { Injectable } from '@nestjs/common';

import { DeviceRepository } from '../../domain/repositories/device.repository';

import { throwDeviceHttpError } from './device-http-error';

@Injectable()
export class ListInactiveDevicesUseCase {
  constructor(
    private readonly deviceRepository:
      DeviceRepository,
  ) {}

  async execute(
    userId: string,
    homeId: string,
  ) {
    return this.deviceRepository
      .findInactiveByHome(
        userId,
        homeId,
      )
      .catch(
        throwDeviceHttpError,
      );
  }
}