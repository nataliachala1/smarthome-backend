import type { device } from '../../../../../../generated/prisma/client';

import { Device } from '../../../domain/entities/device.entity';

export class PrismaDeviceMapper {
  static toDomain(raw: device): Device {
    return new Device({
      id: raw.id_device,
      homeId: raw.id_home,
      deviceTypeId: raw.id_device_type,
      name: raw.name,
      status: raw.status,
      connectivityStatus: raw.connectivity_status,
      isOn: raw.is_on,

      currentPowerW:
        raw.current_power_w === null ? null : Number(raw.current_power_w),

      manufacturerDeviceId: raw.manufacturer_device_id,

      transportType: raw.transport_type,

      messagingProtocol: raw.messaging_protocol,

      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      deletedAt: raw.deleted_at,
    });
  }
}
