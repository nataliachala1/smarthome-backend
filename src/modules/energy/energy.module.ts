import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { CreateHomeEnergyTariffUseCase } from './application/use-cases/create-home-energy-tariff.use-case';
import { GetCurrentHomeEnergyTariffUseCase } from './application/use-cases/get-current-home-energy-tariff.use-case';
import { GetHomeEnergySummaryUseCase } from './application/use-cases/get-home-energy-summary.use-case';
import { GetHomeEnergyGoalUseCase } from './application/use-cases/get-home-energy-goal.use-case';
import { ListHomeEnergyTariffsUseCase } from './application/use-cases/list-home-energy-tariffs.use-case';
import { UpsertHomeEnergyGoalUseCase } from './application/use-cases/upsert-home-energy-goal.use-case';
import { HomeEnergyGoalRepository } from './domain/repositories/home-energy-goal.repository';
import { HomeEnergySummaryRepository } from './domain/repositories/home-energy-summary.repository';
import { HomeEnergyTariffRepository } from './domain/repositories/home-energy-tariff.repository';
import { PrismaHomeEnergyGoalRepository } from './infrastructure/persistence/prisma-home-energy-goal.repository';
import { PrismaHomeEnergySummaryRepository } from './infrastructure/persistence/prisma-home-energy-summary.repository';
import { PrismaHomeEnergyTariffRepository } from './infrastructure/persistence/prisma-home-energy-tariff.repository';
import { HomeEnergyGoalsController } from './presentation/controllers/home-energy-goals.controller';
import { HomeEnergySummaryController } from './presentation/controllers/home-energy-summary.controller';
import { HomeEnergyTariffsController } from './presentation/controllers/home-energy-tariffs.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    HomeEnergyTariffsController,
    HomeEnergyGoalsController,
    HomeEnergySummaryController,
  ],
  providers: [
    ListHomeEnergyTariffsUseCase,
    GetCurrentHomeEnergyTariffUseCase,
    CreateHomeEnergyTariffUseCase,
    GetHomeEnergyGoalUseCase,
    UpsertHomeEnergyGoalUseCase,
    GetHomeEnergySummaryUseCase,
    {
      provide: HomeEnergyTariffRepository,
      useClass: PrismaHomeEnergyTariffRepository,
    },
    {
      provide: HomeEnergyGoalRepository,
      useClass: PrismaHomeEnergyGoalRepository,
    },
    {
      provide: HomeEnergySummaryRepository,
      useClass: PrismaHomeEnergySummaryRepository,
    },
  ],
})
export class EnergyModule {}
