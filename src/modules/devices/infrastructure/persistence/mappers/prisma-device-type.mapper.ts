import { DeviceType } from '../../../domain/entities/device-type.entity';
import type { device_type } from '../../../../../../generated/prisma/client';

export class PrismaDeviceTypeMapper {
  static toDomain(raw: device_type): DeviceType {
    return new DeviceType({
      id: raw.id_device_type,
      name: raw.name,
      description: raw.description,
      icon: raw.icon,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      deletedAt: raw.deleted_at,
    });
  }
}
