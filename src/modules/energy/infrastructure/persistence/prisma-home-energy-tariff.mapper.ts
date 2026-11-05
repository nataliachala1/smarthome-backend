import type { home_energy_tariff as PrismaHomeEnergyTariff } from '../../../../../generated/prisma/client';

import { HomeEnergyTariff } from '../../domain/entities/home-energy-tariff.entity';

/** Convierte 'YYYY-MM-DD' al Date que Prisma usa para columnas DATE (medianoche UTC). */
export function toDbDate(date: string): Date {
  return new Date(date + 'T00:00:00.000Z');
}

/** Convierte un DATE de Prisma (medianoche UTC) a 'YYYY-MM-DD' sin desplazar zona. */
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
