import { Injectable } from '@nestjs/common';

import {
  DeviceControlPublisher,
  PublishDeviceControlCommandInput,
} from '../../domain/services/device-control-publisher';

import { DeviceControlPublisherUnavailableError } from '../../domain/errors/device-control.error';

@Injectable()
export class UnconfiguredDeviceControlPublisher extends DeviceControlPublisher {
  publishControlCommand(
    input: PublishDeviceControlCommandInput,
  ): Promise<void> {
    void input;
    return Promise.reject(new DeviceControlPublisherUnavailableError());
  }
}
