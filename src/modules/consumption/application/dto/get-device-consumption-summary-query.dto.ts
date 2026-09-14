import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class GetDeviceConsumptionSummaryQueryDto {
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
}