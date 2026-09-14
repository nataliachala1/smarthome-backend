import { DeviceType } from '../entities/device-type.entity';

export abstract class DeviceTypeRepository {
  abstract findAll(): Promise<DeviceType[]>;
  abstract findById(id: string): Promise<DeviceType | null>;
}
