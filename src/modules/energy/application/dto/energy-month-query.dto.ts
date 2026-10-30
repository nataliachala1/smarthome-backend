import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

import {
  ENERGY_MONTH_MESSAGE,
  ENERGY_MONTH_PATTERN,
} from '../utils/energy-month';

export class EnergyMonthQueryDto {
  @ApiPropertyOptional({
    description:
      'Mes YYYY-MM (año 2000–2099, mes 01..12). Por defecto, el mes actual en America/Bogota',
    example: '2026-11',
  })
  @IsOptional()
  @Matches(ENERGY_MONTH_PATTERN, { message: 'month ' + ENERGY_MONTH_MESSAGE })
  month?: string;
}
