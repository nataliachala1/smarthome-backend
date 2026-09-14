import { Injectable } from '@nestjs/common';

import { throwDeviceHttpError } from './device-http-error';

import { DeviceRepository } from '../../domain/repositories/device.repository';

import {
  DeviceCannotBeControlledError,
  DeviceControlNotConfiguredError,
  DeviceOfflineForControlError,
} from '../../domain/errors/device-control.error';

import {
  DeviceControlAction,
  DeviceControlPublisher,
} from '../../domain/services/device-control-publisher';

export interface ControlDeviceInput {
  userId: string;
  homeId: string;
  deviceId: string;
  command: DeviceControlAction;
}

@Injectable()
export class ControlDeviceUseCase {
  constructor(
    private readonly deviceRepository: DeviceRepository,
    private readonly deviceControlPublisher: DeviceControlPublisher,
  ) {}

  async execute(input: ControlDeviceInput) {
    try {
      const device = await this.deviceRepository.findForControl(
        input.userId,
        input.homeId,
        input.deviceId,
      );

      if (!device) {
        throw new DeviceCannotBeControlledError();
      }

      if (device.status !== 'ACTIVE' || device.deletedAt !== null) {
        throw new DeviceCannotBeControlledError();
      }

      if (device.connectivityStatus !== 'ONLINE') {
        throw new DeviceOfflineForControlError();
      }

      const manufacturerDeviceId = device.manufacturerDeviceId;

      if (!manufacturerDeviceId || device.messagingProtocol !== 'MQTT') {
        throw new DeviceControlNotConfiguredError();
      }

      await this.deviceControlPublisher.publishControlCommand({
        homeId: device.homeId,
        deviceId: device.id,
        manufacturerDeviceId,
        action: input.command,
      });

      return {
        id: device.id,
        homeId: device.homeId,
        command: input.command,
        status: 'COMMAND_PUBLISHED',
        previousIsOn: device.isOn,
        connectivityStatus: device.connectivityStatus,
      };
    } catch (error) {
      throwDeviceHttpError(error);
    }
  }
}