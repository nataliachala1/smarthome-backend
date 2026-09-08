import { Device } from '../entities/device.entity';

export interface CreateDeviceData {
  homeId: string;
  deviceTypeId: string;
  name: string;
  manufacturerDeviceId: string | null;
  transportType: 'WIFI' | 'BLUETOOTH' | null;
  messagingProtocol: 'MQTT' | null;
}

export abstract class DeviceRepository {
  abstract findAllByHome(userId: string, homeId: string): Promise<Device[]>;

  abstract create(userId: string, data: CreateDeviceData): Promise<Device>;
}
