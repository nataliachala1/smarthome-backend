import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

import { ENERGY_MONTH_PATTERN } from '../utils/energy-month';

export class EnergyMonthQueryDto {
  @ApiPropertyOptional({
    description:
      'Mes YYYY-MM (01..12). Por defecto, el mes actual en America/Bogota',
    example: '2026-11',
  })
  @IsOptional()
  @Matches(ENERGY_MONTH_PATTERN, {
    message: 'month debe tener formato YYYY-MM con mes entre 01 y 12',
  })
  month?: string;
}
