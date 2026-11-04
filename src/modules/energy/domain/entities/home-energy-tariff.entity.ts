export interface HomeEnergyTariffProps {
  id: string;
  homeId: string;
  /** Decimal exacto como texto, 4 decimales (NUMERIC(14,4)). */
  unitPriceCopKwh: string;
  /** Fecha local America/Bogota en formato YYYY-MM-DD. */
  effectiveFrom: string;
  createdAt: Date;
}

export class HomeEnergyTariff {
  constructor(private readonly props: HomeEnergyTariffProps) {}

  get id(): string {
    return this.props.id;
  }

  get homeId(): string {
    return this.props.homeId;
  }

  get unitPriceCopKwh(): string {
    return this.props.unitPriceCopKwh;
  }

  get effectiveFrom(): string {
    return this.props.effectiveFrom;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
