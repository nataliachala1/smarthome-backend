export type DeviceControlAction = 'TURN_ON' | 'TURN_OFF';

export interface PublishDeviceControlCommandInput {
  homeId: string;
  deviceId: string;
  manufacturerDeviceId: string;
  action: DeviceControlAction;
}

export abstract class DeviceControlPublisher {
  abstract publishControlCommand(
    input: PublishDeviceControlCommandInput,
  ): Promise<void>;
}