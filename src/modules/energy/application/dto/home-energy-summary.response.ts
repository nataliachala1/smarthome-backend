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
    description: 'Inicio del mes en Bogotá (incluido)',
  })
  from: string;

  @ApiProperty({
    example: '2026-12-01T05:00:00.000Z',
    format: 'date-time',
    description: 'Inicio del mes siguiente en Bogotá (excluido)',
  })
  to: string;

  @ApiProperty({ example: 1240 })
  readingsCount: number;

  @ApiProperty({
    example: 0,
    description: 'Lecturas con consumo sin tarifa vigente en su fecha local',
  })
  unpricedReadings: number;

  @ApiProperty({
    example: '82.400000',
    description: 'kWh del mes (6 decimales)',
  })
  totalKwh: string;

  @ApiProperty({
    example: true,
    description:
      'true si todas las lecturas con consumo tienen tarifa aplicable',
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
    description: 'Costo de las lecturas que sí tienen tarifa',
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
    description: 'Costo estimado / presupuesto * 100 (puede superar 100)',
  })
  budgetUsagePercent: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '65.92',
    description: 'kWh del mes / meta * 100 (puede superar 100)',
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
