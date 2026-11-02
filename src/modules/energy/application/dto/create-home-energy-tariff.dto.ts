import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';

import {
  ENERGY_DATE_MESSAGE,
  ENERGY_DATE_PATTERN,
} from '../utils/energy-month';
import { IsPositiveDecimalString } from '../validators/is-positive-decimal-string.validator';

export class CreateHomeEnergyTariffDto {
  @ApiProperty({
    description:
      'Tarifa referencial COP por kWh como texto decimal (> 0, máx. 10 enteros y 4 decimales)',
    example: '950.2500',
  })
  @IsPositiveDecimalString(14, 4)
  unitPriceCopKwh: string;

  @ApiProperty({
    description:
      'Fecha de entrada en vigor (calendario America/Bogota), año 2000–2099',
    example: '2026-11-01',
    format: 'date',
  })
  @Matches(ENERGY_DATE_PATTERN, {
    message: 'effectiveFrom ' + ENERGY_DATE_MESSAGE,
  })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'effectiveFrom debe ser una fecha real' },
  )
  effectiveFrom: string;
}
