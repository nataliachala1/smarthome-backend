import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, Matches } from 'class-validator';

import {
  ENERGY_DATE_MESSAGE,
  ENERGY_DATE_PATTERN,
} from '../utils/energy-month';

export class CurrentHomeEnergyTariffQueryDto {
  @ApiPropertyOptional({
    description:
      'Fecha local YYYY-MM-DD (año 2000–2099) para la que se busca la tarifa vigente. Por defecto, hoy en America/Bogota',
    example: '2026-11-01',
    format: 'date',
  })
  @IsOptional()
  @Matches(ENERGY_DATE_PATTERN, { message: 'at ' + ENERGY_DATE_MESSAGE })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'at debe ser una fecha real' },
  )
  at?: string;
}
