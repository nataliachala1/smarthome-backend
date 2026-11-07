jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

import { GUARDS_METADATA } from '@nestjs/common/constants';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { HomeEnergyGoalsController } from './home-energy-goals.controller';
import { HomeEnergySummaryController } from './home-energy-summary.controller';
import { HomeEnergyTariffsController } from './home-energy-tariffs.controller';

describe('Energy controllers: authentication is mandatory', () => {
  it.each([
    ['HomeEnergyTariffsController', HomeEnergyTariffsController],
    ['HomeEnergyGoalsController', HomeEnergyGoalsController],
    ['HomeEnergySummaryController', HomeEnergySummaryController],
  ])('%s requires JwtAuthGuard on every route', (_name, controller) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as
      unknown[] | undefined;

    expect(guards).toContain(JwtAuthGuard);
  });
});
