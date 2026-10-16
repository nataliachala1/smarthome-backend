import {
  authorizeConsumptionDetail,
  historyDevices,
} from '../consumption-access';
import { BadRequestException, Injectable } from '@nestjs/common';

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
      await authorizeConsumptionDetail(tx, input.homeId);

      const rows = await tx.consumption.findMany({
        where: {
          id_home: input.homeId,
          ...(from || to ? { read_at: readAtFilter } : {}),
        },
        orderBy: {
          read_at: 'desc',
        },
        take: limit,
      });

      const metadata = await historyDevices(tx, input.homeId, [
        ...new Set(rows.map((row) => row.id_device)),
      ]);
      const devices = new Map(
        metadata.map((device) => [device.id_device, device]),
      );
      return rows.map((row) => ({
        id: row.id_consumption,
        homeId: row.id_home,
        deviceId: row.id_device,
        deviceName: devices.get(row.id_device)?.name ?? null,
        manufacturerDeviceId:
          devices.get(row.id_device)?.manufacturer_device_id ?? null,
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
