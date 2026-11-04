import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

export interface GetHomeConsumptionSummaryInput {
  userId: string;
  homeId: string;
  from?: string;
  to?: string;
}

@Injectable()
export class GetHomeConsumptionSummaryUseCase {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async execute(input: GetHomeConsumptionSummaryInput) {
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
        SELECT consumption.fn_can_read_detail(${input.homeId}::uuid) AS allowed
      `;
      if (!access?.allowed) {
        const [summary] = await tx.$queryRaw<
          { total_energy_delta_kwh: unknown }[]
        >`
          SELECT * FROM consumption.fn_basic_home_consumption(${input.homeId}::uuid, ${from ?? null}::timestamptz, ${to ?? null}::timestamptz)
        `;
        if (!summary)
          throw new ForbiddenException({
            code: 'CONSUMPTION_SUMMARY_FORBIDDEN',
            message: 'Sin permisos para consultar consumo de este hogar',
          });
        return {
          homeId: input.homeId,
          from: from ?? null,
          to: to ?? null,
          totalEnergyDeltaKwh: Number(summary.total_energy_delta_kwh),
        };
      }

      const where = {
        id_home: input.homeId,
        ...(from || to ? { read_at: readAtFilter } : {}),
      };

      const [aggregate, latest, devicesWithReadings] = await Promise.all([
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
            read_at: true,
          },
        }),

        tx.consumption.findMany({
          where,
          distinct: ['id_device'],
          select: {
            id_device: true,
          },
        }),
      ]);

      return {
        homeId: input.homeId,
        from: from ?? null,
        to: to ?? null,
        readingsCount: aggregate._count._all,
        devicesWithReadings: devicesWithReadings.length,
        totalEnergyDeltaKwh:
          aggregate._sum.energy_delta_kwh === null
            ? 0
            : Number(aggregate._sum.energy_delta_kwh),
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
