import type { home_energy_tariff as PrismaHomeEnergyTariff } from '../../../../../generated/prisma/client';

import { HomeEnergyTariff } from '../../domain/entities/home-energy-tariff.entity';

/** Converts 'YYYY-MM-DD' to the Date Prisma uses for DATE columns (UTC midnight). */
export function toDbDate(date: string): Date {
  return new Date(date + 'T00:00:00.000Z');
}

/** Converts a Prisma DATE (UTC midnight) to 'YYYY-MM-DD' without shifting the zone. */
export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class PrismaHomeEnergyTariffMapper {
  static toDomain(raw: PrismaHomeEnergyTariff): HomeEnergyTariff {
    return new HomeEnergyTariff({
      id: raw.id_home_energy_tariff,
      homeId: raw.id_home,
      unitPriceCopKwh: raw.unit_price_cop_kwh.toFixed(4),
      effectiveFrom: fromDbDate(raw.effective_from),
      createdAt: raw.created_at,
    });
  }
}
