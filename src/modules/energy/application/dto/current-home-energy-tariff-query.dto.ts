import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, Matches } from 'class-validator';

export class CurrentHomeEnergyTariffQueryDto {
  @ApiPropertyOptional({
    description:
      'Fecha local YYYY-MM-DD para la que se busca la tarifa vigente. Por defecto, hoy en America/Bogota',
    example: '2026-11-01',
    format: 'date',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'at debe tener formato YYYY-MM-DD',
  })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'at debe ser una fecha real' },
  )
  at?: string;
}
