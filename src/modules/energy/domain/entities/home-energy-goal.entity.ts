import { EnergyGoalRequiresValueError } from '../errors/energy.errors';

export interface HomeEnergyGoalProps {
  id: string;
  homeId: string;
  /** Mes calendario YYYY-MM (en BD se guarda como el día 1 del mes). */
  month: string;
  /** Presupuesto COP como texto con 2 decimales; null si no se configuró. */
  monthlyBudgetCop: string | null;
  /** Meta de consumo kWh como texto con 6 decimales; null si no se configuró. */
  targetKwh: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Regla SQL034/002: un objetivo mensual debe tener presupuesto COP,
 * meta kWh o ambos. Nunca los dos ausentes.
 */
export function assertEnergyGoalHasValue(
  monthlyBudgetCop: string | null,
  targetKwh: string | null,
): void {
  if (monthlyBudgetCop === null && targetKwh === null) {
    throw new EnergyGoalRequiresValueError();
  }
}

export class HomeEnergyGoal {
  constructor(private readonly props: HomeEnergyGoalProps) {}

  get id(): string {
    return this.props.id;
  }

  get homeId(): string {
    return this.props.homeId;
  }

  get month(): string {
    return this.props.month;
  }

  get monthlyBudgetCop(): string | null {
    return this.props.monthlyBudgetCop;
  }

  get targetKwh(): string | null {
    return this.props.targetKwh;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
