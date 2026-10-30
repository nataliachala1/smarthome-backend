import { ApiProperty } from '@nestjs/swagger';

import { HomeEnergyGoal } from '../../domain/entities/home-energy-goal.entity';

export class HomeEnergyGoalResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  homeId: string;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ type: String, nullable: true, example: '120000.00' })
  monthlyBudgetCop: string | null;

  @ApiProperty({ type: String, nullable: true, example: '125.000000' })
  targetKwh: string | null;

  @ApiProperty({ example: '2026-10-30T17:00:00.000Z', format: 'date-time' })
  createdAt: string;

  @ApiProperty({ example: '2026-10-30T17:00:00.000Z', format: 'date-time' })
  updatedAt: string;
}

export class MonthHomeEnergyGoalResponse {
  @ApiProperty({ format: 'uuid' })
  homeId: string;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({
    type: HomeEnergyGoalResponse,
    nullable: true,
    description: 'null si el mes no tiene presupuesto ni meta configurados',
  })
  goal: HomeEnergyGoalResponse | null;
}

export function toHomeEnergyGoalResponse(
  goal: HomeEnergyGoal,
): HomeEnergyGoalResponse {
  return {
    id: goal.id,
    homeId: goal.homeId,
    month: goal.month,
    monthlyBudgetCop: goal.monthlyBudgetCop,
    targetKwh: goal.targetKwh,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}
