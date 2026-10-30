import { assertEnergyGoalHasValue } from './home-energy-goal.entity';
import { EnergyGoalRequiresValueError } from '../errors/energy.errors';

describe('assertEnergyGoalHasValue', () => {
  it('acepta solo presupuesto, solo meta o ambos', () => {
    expect(() => assertEnergyGoalHasValue('1.00', null)).not.toThrow();
    expect(() => assertEnergyGoalHasValue(null, '1.000000')).not.toThrow();
    expect(() => assertEnergyGoalHasValue('1.00', '1.000000')).not.toThrow();
  });

  it('rechaza presupuesto y meta ausentes a la vez', () => {
    expect(() => assertEnergyGoalHasValue(null, null)).toThrow(
      EnergyGoalRequiresValueError,
    );
  });
});
