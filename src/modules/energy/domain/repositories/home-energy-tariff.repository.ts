import { HomeEnergyTariff } from '../entities/home-energy-tariff.entity';

export interface CreateHomeEnergyTariffData {
  homeId: string;
  /** Positive decimal as text, at most 10 integer digits and 4 decimals. */
  unitPriceCopKwh: string;
  /** Local date YYYY-MM-DD. */
  effectiveFrom: string;
}

/**
 * Persistence port for SQL034 tariffs.
 * Tariffs are immutable: there are no update or delete methods.
 */
export abstract class HomeEnergyTariffRepository {
  /** Full history ordered by descending effective date. */
  abstract findAllByHome(
    userId: string,
    homeId: string,
  ): Promise<HomeEnergyTariff[]>;

  /** Tariff with the greatest effective_from <= date (never a future tariff). */
  abstract findEffectiveAt(
    userId: string,
    homeId: string,
    date: string,
  ): Promise<HomeEnergyTariff | null>;

  abstract create(
    userId: string,
    data: CreateHomeEnergyTariffData,
  ): Promise<HomeEnergyTariff>;
}
