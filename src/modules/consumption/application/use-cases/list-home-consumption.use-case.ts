import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

export interface ListHomeConsumptionInput {
  userId: string;
  homeId: string;
  from?: string;
  to?: string;
  limit?: number;
}

@Injectable()
export class ListHomeConsumptionUseCase {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async execute(input: ListHomeConsumptionInput) {
    const limit = input.limit ?? 50;

    const from = input.from ? new Date(input.from) : undefined;
    const to = input.to ? new Date(input.to) : undefined;

    if (from && to && from > to) {
      throw new BadRequestException('El rango de fechas es inválido');
    }

    const readAtFilter: { gte?: Date; lte?: Date } = {};

    if (from) {
      readAtFilter.gte = from;
    }

    if (to) {
      readAtFilter.lte = to;
    }

    return await this.prismaRls.withUserContext(input.userId, async (tx) => {
      const [access] = await tx.$queryRaw<{ allowed: boolean }[]>`
        SELECT (
          homes.fn_is_home_owner(${input.homeId}::uuid) OR (
            homes.fn_is_home_active(${input.homeId}::uuid) AND
            homes.fn_is_home_member(${input.homeId}::uuid, ARRAY['MEMBER', 'GUEST']::text[])
          )
        ) AS allowed
      `;

      if (!access?.allowed) {
        throw new ForbiddenException(
          'Sin permisos para consultar consumo de este hogar',
        );
      }

      const rows = await tx.consumption.findMany({
        where: {
          id_home: input.homeId,
          ...(from || to ? { read_at: readAtFilter } : {}),
        },
        orderBy: {
          read_at: 'desc',
        },
        take: limit,
        include: {
          device: {
            select: {
              name: true,
              manufacturer_device_id: true,
            },
          },
        },
      });

      return rows.map((row) => ({
        id: row.id_consumption,
        homeId: row.id_home,
        deviceId: row.id_device,
        deviceName: row.device.name,
        manufacturerDeviceId: row.device.manufacturer_device_id,
        powerW: Number(row.power_w),
        energyDeltaKwh: Number(row.energy_delta_kwh),
        energyTotalKwh:
          row.energy_total_kwh === null ? null : Number(row.energy_total_kwh),
        voltageV: row.voltage_v === null ? null : Number(row.voltage_v),
        currentA: row.current_a === null ? null : Number(row.current_a),
        frequencyHz:
          row.frequency_hz === null ? null : Number(row.frequency_hz),
        temperatureC:
          row.temperature_c === null ? null : Number(row.temperature_c),
        readAt: row.read_at,
      }));
    });
  }
}