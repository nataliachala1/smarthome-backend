import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

export interface GetHomeDailyConsumptionInput {
  userId: string;
  homeId: string;
  from?: string;
  to?: string;
}

interface HomeDailyConsumptionRow {
  period_start: Date;
  readings_count: number;
  total_energy_delta_kwh: unknown;
  average_power_w: unknown | null;
  max_power_w: unknown | null;
  min_power_w: unknown | null;
}

@Injectable()
export class GetHomeDailyConsumptionUseCase {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async execute(input: GetHomeDailyConsumptionInput) {
    const from = input.from ? new Date(input.from) : undefined;
    const to = input.to ? new Date(input.to) : undefined;

    if (from && to && from > to) {
      throw new BadRequestException('El rango de fechas es inválido');
    }

    const fromValue = from ?? null;
    const toValue = to ?? null;

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

      const rows = await tx.$queryRaw<HomeDailyConsumptionRow[]>`
        SELECT
          date_trunc('day', c.read_at) AS period_start,
          COUNT(*)::int AS readings_count,
          COALESCE(SUM(c.energy_delta_kwh), 0) AS total_energy_delta_kwh,
          AVG(c.power_w) AS average_power_w,
          MAX(c.power_w) AS max_power_w,
          MIN(c.power_w) AS min_power_w
        FROM consumption.consumption c
        WHERE c.id_home = ${input.homeId}::uuid
          AND (${fromValue}::timestamptz IS NULL OR c.read_at >= ${fromValue}::timestamptz)
          AND (${toValue}::timestamptz IS NULL OR c.read_at <= ${toValue}::timestamptz)
        GROUP BY period_start
        ORDER BY period_start ASC
      `;

      return rows.map((row) => ({
        homeId: input.homeId,
        periodStart: row.period_start,
        readingsCount: row.readings_count,
        totalEnergyDeltaKwh: Number(row.total_energy_delta_kwh),
        averagePowerW:
          row.average_power_w === null ? null : Number(row.average_power_w),
        maxPowerW: row.max_power_w === null ? null : Number(row.max_power_w),
        minPowerW: row.min_power_w === null ? null : Number(row.min_power_w),
      }));
    });
  }
}