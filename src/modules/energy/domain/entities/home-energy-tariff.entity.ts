export interface HomeEnergyTariffProps {
  id: string;
  homeId: string;
  /** Exact decimal as text, 4 decimals (NUMERIC(14,4)). */
  unitPriceCopKwh: string;
  /** Local America/Bogota date in YYYY-MM-DD format. */
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
