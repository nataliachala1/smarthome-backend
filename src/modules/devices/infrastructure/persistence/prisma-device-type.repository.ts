import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';
import { DeviceTypeRepository } from '../../domain/repositories/device-type.repository';
import { DeviceType } from '../../domain/entities/device-type.entity';
import { PrismaDeviceTypeMapper } from './../persistence/mappers/prisma-device-type.mapper';

@Injectable()
export class PrismaDeviceTypeRepository implements DeviceTypeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<DeviceType[]> {
    const rows = await this.prisma.device_type.findMany({
      where: {
        deleted_at: null,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return rows.map((row) => PrismaDeviceTypeMapper.toDomain(row));
  }

  async findById(id: string): Promise<DeviceType | null> {
    const raw = await this.prisma.device_type.findFirst({
      where: {
        id_device_type: id,
        deleted_at: null,
      },
    });

    return raw ? PrismaDeviceTypeMapper.toDomain(raw) : null;
  }
}
