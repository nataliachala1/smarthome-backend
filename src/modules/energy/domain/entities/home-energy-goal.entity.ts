import { EnergyGoalRequiresValueError } from '../errors/energy.errors';

export interface HomeEnergyGoalProps {
  id: string;
  homeId: string;
  /** Calendar month YYYY-MM (stored in the DB as the first day of the month). */
  month: string;
  /** COP budget as text with 2 decimals; null when not configured. */
  monthlyBudgetCop: string | null;
  /** kWh consumption target as text with 6 decimals; null when not configured. */
  targetKwh: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * SQL034/002 rule: a monthly goal must have a COP budget,
 * a kWh target or both. Never both missing.
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
