import { HomeEnergyTariff } from '../entities/home-energy-tariff.entity';

export interface CreateHomeEnergyTariffData {
  homeId: string;
  /** Decimal positivo como texto, máximo 10 enteros y 4 decimales. */
  unitPriceCopKwh: string;
  /** Fecha local YYYY-MM-DD. */
  effectiveFrom: string;
}

/**
 * Puerto de persistencia de tarifas SQL034.
 * Las tarifas son inmutables: no existen métodos de actualización ni borrado.
 */
export abstract class HomeEnergyTariffRepository {
  /** Historial completo ordenado por vigencia descendente. */
  abstract findAllByHome(
    userId: string,
    homeId: string,
  ): Promise<HomeEnergyTariff[]>;

  /** Tarifa con mayor effective_from <= date (nunca una tarifa futura). */
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
