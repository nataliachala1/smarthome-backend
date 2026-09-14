import { Device } from '../entities/device.entity';

export interface CreateDeviceData {
  homeId: string;
  deviceTypeId: string;
  name: string;
  manufacturerDeviceId: string | null;
  transportType: 'WIFI' | 'BLUETOOTH' | null;
  messagingProtocol: 'MQTT' | null;
}

export interface UpdateDeviceData {
  deviceTypeId?: string;
  name?: string;
  transportType?: 'WIFI' | 'BLUETOOTH' | null;
  messagingProtocol?: 'MQTT' | null;
}

export abstract class DeviceRepository {
  abstract findAllByHome(userId: string, homeId: string): Promise<Device[]>;

  abstract findById(
    userId: string,
    homeId: string,
    deviceId: string,
  ): Promise<Device | null>;

  abstract findForControl(
  userId: string,
  homeId: string,
  deviceId: string,
): Promise<Device | null>;

  abstract create(userId: string, data: CreateDeviceData): Promise<Device>;

  abstract update(
    userId: string,
    homeId: string,
    deviceId: string,
    data: UpdateDeviceData,
  ): Promise<Device>;

  abstract deactivate(
    userId: string,
    homeId: string,
    deviceId: string,
  ): Promise<Device>;
}
