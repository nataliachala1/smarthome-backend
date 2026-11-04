import { ApiProperty } from '@nestjs/swagger';

import { HomeEnergyTariff } from '../../domain/entities/home-energy-tariff.entity';

export class HomeEnergyTariffResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  homeId: string;

  @ApiProperty({
    example: '950.2500',
    description: 'Decimal exacto como texto',
  })
  unitPriceCopKwh: string;

  @ApiProperty({ example: '2026-11-01', format: 'date' })
  effectiveFrom: string;

  @ApiProperty({ example: '2026-10-29T17:00:00.000Z', format: 'date-time' })
  createdAt: string;
}

export class HomeEnergyTariffListResponse {
  @ApiProperty({ format: 'uuid' })
  homeId: string;

  @ApiProperty({
    type: [HomeEnergyTariffResponse],
    description: 'Ordenadas por effectiveFrom descendente',
  })
  tariffs: HomeEnergyTariffResponse[];
}

export class CurrentHomeEnergyTariffResponse {
  @ApiProperty({ format: 'uuid' })
  homeId: string;

  @ApiProperty({ example: '2026-11-01', format: 'date' })
  at: string;

  @ApiProperty({
    type: HomeEnergyTariffResponse,
    nullable: true,
    description: 'null si no hay tarifa vigente para esa fecha',
  })
  tariff: HomeEnergyTariffResponse | null;
}

export function toHomeEnergyTariffResponse(
  tariff: HomeEnergyTariff,
): HomeEnergyTariffResponse {
  return {
    id: tariff.id,
    homeId: tariff.homeId,
    unitPriceCopKwh: tariff.unitPriceCopKwh,
    effectiveFrom: tariff.effectiveFrom,
    createdAt: tariff.createdAt.toISOString(),
  };
}
