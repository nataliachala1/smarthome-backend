import { ApiProperty } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';

import { IsPositiveDecimalString } from '../validators/is-positive-decimal-string.validator';

/**
 * PUT = full replacement: both fields are required in the JSON.
 * null means "not configured"; omitting the field is a 400 error.
 * At least one of the two must be different from null.
 */
export class UpsertHomeEnergyGoalDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '120000.00',
    description:
      'Monthly COP budget as text (> 0, at most 12 integer digits and 2 decimals) or null',
  })
  @ValidateIf((dto: UpsertHomeEnergyGoalDto) => dto.monthlyBudgetCop !== null)
  @IsPositiveDecimalString(14, 2)
  monthlyBudgetCop: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '125.000000',
    description:
      'Monthly kWh consumption target as text (> 0, at most 8 integer digits and 6 decimals) or null',
  })
  @ValidateIf((dto: UpsertHomeEnergyGoalDto) => dto.targetKwh !== null)
  @IsPositiveDecimalString(14, 6)
  targetKwh: string | null;
}
