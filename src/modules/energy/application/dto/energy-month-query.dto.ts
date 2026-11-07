import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

import {
  ENERGY_MONTH_MESSAGE,
  ENERGY_MONTH_PATTERN,
} from '../utils/energy-month';

export class EnergyMonthQueryDto {
  @ApiPropertyOptional({
    description:
      'Month YYYY-MM (year 2000–2099, month 01..12). Defaults to the current month in America/Bogota',
    example: '2026-11',
  })
  @IsOptional()
  @Matches(ENERGY_MONTH_PATTERN, { message: 'month ' + ENERGY_MONTH_MESSAGE })
  month?: string;
}
