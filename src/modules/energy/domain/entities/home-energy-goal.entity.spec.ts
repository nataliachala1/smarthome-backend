import { assertEnergyGoalHasValue } from './home-energy-goal.entity';
import { EnergyGoalRequiresValueError } from '../errors/energy.errors';

describe('assertEnergyGoalHasValue', () => {
  it('accepts only a budget, only a target or both', () => {
    expect(() => assertEnergyGoalHasValue('1.00', null)).not.toThrow();
    expect(() => assertEnergyGoalHasValue(null, '1.000000')).not.toThrow();
    expect(() => assertEnergyGoalHasValue('1.00', '1.000000')).not.toThrow();
  });

  it('rejects a missing budget and target at the same time', () => {
    expect(() => assertEnergyGoalHasValue(null, null)).toThrow(
      EnergyGoalRequiresValueError,
    );
  });
});
