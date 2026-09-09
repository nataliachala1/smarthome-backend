import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class ListHomeConsumptionQueryDto {
  @IsOptional()
  @IsDateString()
  @ApiPropertyOptional({
    description: 'Fecha inicial en formato ISO',
    example: '2026-09-09T00:00:00.000Z',
  })
  from?: string;

  @IsOptional()
  @IsDateString()
  @ApiPropertyOptional({
    description: 'Fecha final en formato ISO',
    example: '2026-09-09T23:59:59.999Z',
  })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @ApiPropertyOptional({
    description: 'Cantidad máxima de lecturas a retornar',
    minimum: 1,
    maximum: 200,
    default: 50,
  })
  limit?: number;
}