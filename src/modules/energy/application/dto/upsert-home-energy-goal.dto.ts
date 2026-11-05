import { ApiProperty } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';

import { IsPositiveDecimalString } from '../validators/is-positive-decimal-string.validator';

/**
 * PUT = reemplazo completo: ambos campos son obligatorios en el JSON.
 * null significa "no configurado"; omitir el campo es un error 400.
 * Al menos uno de los dos debe ser distinto de null.
 */
export class UpsertHomeEnergyGoalDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '120000.00',
    description:
      'Presupuesto mensual COP como texto (> 0, máx. 12 enteros y 2 decimales) o null',
  })
  @ValidateIf((dto: UpsertHomeEnergyGoalDto) => dto.monthlyBudgetCop !== null)
  @IsPositiveDecimalString(14, 2)
  monthlyBudgetCop: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '125.000000',
    description:
      'Meta mensual de consumo kWh como texto (> 0, máx. 8 enteros y 6 decimales) o null',
  })
  @ValidateIf((dto: UpsertHomeEnergyGoalDto) => dto.targetKwh !== null)
  @IsPositiveDecimalString(14, 6)
  targetKwh: string | null;
}
