import {
  authorizeConsumptionDetail,
  requireHistoryDevice,
} from '../consumption-access';
import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

export interface GetDeviceConsumptionSummaryInput {
  userId: string;
  homeId: string;
  deviceId: string;
  from?: string;
  to?: string;
}

@Injectable()
export class GetDeviceConsumptionSummaryUseCase {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async execute(input: GetDeviceConsumptionSummaryInput) {
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

      await requireHistoryDevice(tx, input.homeId, input.deviceId);

      const where = {
        id_device: input.deviceId,
        id_home: input.homeId,
        ...(from || to ? { read_at: readAtFilter } : {}),
      };

      const [aggregate, latest] = await Promise.all([
        tx.consumption.aggregate({
          where,
          _count: {
            _all: true,
          },
          _sum: {
            energy_delta_kwh: true,
          },
          _avg: {
            power_w: true,
          },
          _max: {
            power_w: true,
          },
          _min: {
            power_w: true,
          },
        }),

        tx.consumption.findFirst({
          where,
          orderBy: {
            read_at: 'desc',
          },
          select: {
            energy_total_kwh: true,
            read_at: true,
          },
        }),
      ]);

      return {
        homeId: input.homeId,
        deviceId: input.deviceId,
        from: from ?? null,
        to: to ?? null,
        readingsCount: aggregate._count._all,
        totalEnergyDeltaKwh:
          aggregate._sum.energy_delta_kwh === null
            ? 0
            : Number(aggregate._sum.energy_delta_kwh),
        latestEnergyTotalKwh:
          latest?.energy_total_kwh === null ||
          latest?.energy_total_kwh === undefined
            ? null
            : Number(latest.energy_total_kwh),
        averagePowerW:
          aggregate._avg.power_w === null
            ? null
            : Number(aggregate._avg.power_w),
        maxPowerW:
          aggregate._max.power_w === null
            ? null
            : Number(aggregate._max.power_w),
        minPowerW:
          aggregate._min.power_w === null
            ? null
            : Number(aggregate._min.power_w),
        latestReadAt: latest?.read_at ?? null,
      };
    });
  }
}
