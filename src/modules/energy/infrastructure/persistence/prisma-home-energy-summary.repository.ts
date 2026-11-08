import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../../generated/prisma/client';
import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import { isPostgresAccessDeniedError } from '../../../../infrastructure/database/prisma/prisma-error.util';

import { EnergyMonthFacts } from '../../domain/entities/home-energy-summary';
import {
  EnergyMonthPeriod,
  HomeEnergySummaryRepository,
} from '../../domain/repositories/home-energy-summary.repository';

import {
  assertCanReadEnergy,
  energyAccessDeniedError,
  EnergyAccessKind,
} from './energy-access';

interface MonthFactsRow {
  readings_count: number;
  unpriced_readings: number;
  total_kwh: string;
  priced_cost_cop: string;
  monthly_budget_cop: string | null;
  target_kwh: string | null;
}

/**
 * Computes the month totals in PostgreSQL (exact NUMERIC):
 * - each reading takes the tariff with the greatest effective_from <= its date in America/Bogota;
 * - a future tariff, or the current tariff for the whole period, is never applied;
 * - the range is [from, to) by read_at; RLS decides the visible rows.
 * Runs after consumption.fn_can_read_detail, in the same transaction.
 *
 * Important: instants are sent as ISO text with a zone (toISOString) so that
 * PostgreSQL does not interpret them in the session/server time zone.
 */
@Injectable()
export class PrismaHomeEnergySummaryRepository implements HomeEnergySummaryRepository {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async getMonthFacts(
    userId: string,
    period: EnergyMonthPeriod,
  ): Promise<EnergyMonthFacts> {
    return this.run(userId, 'read', async (tx) => {
      await assertCanReadEnergy(tx, period.homeId);

      const [row] = await tx.$queryRaw<MonthFactsRow[]>`
        WITH readings AS (
          SELECT c.energy_delta_kwh, t.unit_price_cop_kwh
          FROM consumption.consumption AS c
          LEFT JOIN LATERAL (
            SELECT tariff.unit_price_cop_kwh
            FROM config.home_energy_tariff AS tariff
            WHERE tariff.id_home = c.id_home
              AND tariff.effective_from <= (c.read_at AT TIME ZONE 'America/Bogota')::date
            ORDER BY tariff.effective_from DESC
            LIMIT 1
          ) AS t ON TRUE
          WHERE c.id_home = ${period.homeId}::uuid
            AND c.read_at >= ${period.from.toISOString()}::timestamptz
            AND c.read_at < ${period.to.toISOString()}::timestamptz
        ),
        totals AS (
          SELECT
            COUNT(*)::int AS readings_count,
            (COUNT(*) FILTER (
              WHERE unit_price_cop_kwh IS NULL AND energy_delta_kwh <> 0
            ))::int AS unpriced_readings,
            COALESCE(SUM(energy_delta_kwh), 0) AS total_kwh,
            COALESCE(SUM(energy_delta_kwh * unit_price_cop_kwh), 0) AS priced_cost_cop
          FROM readings
        )
        SELECT
          totals.readings_count,
          totals.unpriced_readings,
          totals.total_kwh::text AS total_kwh,
          totals.priced_cost_cop::text AS priced_cost_cop,
          goal.monthly_budget_cop::text AS monthly_budget_cop,
          goal.target_kwh::text AS target_kwh
        FROM totals
        LEFT JOIN config.home_energy_goal AS goal
          ON goal.id_home = ${period.homeId}::uuid
         AND goal.month_start = ${period.month + '-01'}::date
      `;

      return {
        readingsCount: row?.readings_count ?? 0,
        unpricedReadings: row?.unpriced_readings ?? 0,
        totalKwh: row?.total_kwh ?? '0',
        pricedCostCop: row?.priced_cost_cop ?? '0',
        monthlyBudgetCop: row?.monthly_budget_cop ?? null,
        targetKwh: row?.target_kwh ?? null,
      };
    });
  }

  private async run<T>(
    userId: string,
    access: EnergyAccessKind,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prismaRls.withUserContext(userId, operation);
    } catch (error) {
      // 42501 (privilege or RLS policy): reported according to the operation,
      // without exposing SQL details.
      if (isPostgresAccessDeniedError(error)) {
        throw energyAccessDeniedError(access);
      }

      throw error;
    }
  }
}
