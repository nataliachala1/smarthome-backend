import { ApiProperty } from '@nestjs/swagger';

import { HomeEnergySummary } from '../../domain/entities/home-energy-summary';

export class HomeEnergySummaryResponse {
  @ApiProperty({ format: 'uuid' })
  homeId: string;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ example: 'America/Bogota' })
  timezone: string;

  @ApiProperty({
    example: '2026-11-01T05:00:00.000Z',
    format: 'date-time',
    description: 'Start of the month in Bogota (included)',
  })
  from: string;

  @ApiProperty({
    example: '2026-12-01T05:00:00.000Z',
    format: 'date-time',
    description: 'Start of the next month in Bogota (excluded)',
  })
  to: string;

  @ApiProperty({ example: 1240 })
  readingsCount: number;

  @ApiProperty({
    example: 0,
    description: 'Readings with consumption and no tariff effective on their local date',
  })
  unpricedReadings: number;

  @ApiProperty({
    example: '82.400000',
    description: 'kWh of the month (6 decimals)',
  })
  totalKwh: string;

  @ApiProperty({
    example: true,
    description:
      'true when every reading with consumption has an applicable tariff',
  })
  costComplete: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '78300.60',
    description:
      'Costo estimado COP (2 decimales); null si costComplete es false',
  })
  estimatedCostCop: string | null;

  @ApiProperty({
    example: '78300.60',
    description: 'Cost of the readings that do have a tariff',
  })
  partialCostCop: string;

  @ApiProperty({ type: String, nullable: true, example: '120000.00' })
  monthlyBudgetCop: string | null;

  @ApiProperty({ type: String, nullable: true, example: '125.000000' })
  targetKwh: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '65.25',
    description: 'Estimated cost / budget * 100 (may exceed 100)',
  })
  budgetUsagePercent: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '65.92',
    description: 'kWh of the month / target * 100 (may exceed 100)',
  })
  targetUsagePercent: string | null;

  @ApiProperty({ example: 'COP' })
  currency: 'COP';
}

export function toHomeEnergySummaryResponse(
  summary: HomeEnergySummary,
): HomeEnergySummaryResponse {
  return {
    ...summary,
    from: summary.from.toISOString(),
    to: summary.to.toISOString(),
  };
}
