import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { CreateHomeEnergyTariffUseCase } from './application/use-cases/create-home-energy-tariff.use-case';
import { GetCurrentHomeEnergyTariffUseCase } from './application/use-cases/get-current-home-energy-tariff.use-case';
import { ListHomeEnergyTariffsUseCase } from './application/use-cases/list-home-energy-tariffs.use-case';
import { HomeEnergyTariffRepository } from './domain/repositories/home-energy-tariff.repository';
import { PrismaHomeEnergyTariffRepository } from './infrastructure/persistence/prisma-home-energy-tariff.repository';
import { HomeEnergyTariffsController } from './presentation/controllers/home-energy-tariffs.controller';

@Module({
  imports: [AuthModule],
  controllers: [HomeEnergyTariffsController],
  providers: [
    ListHomeEnergyTariffsUseCase,
    GetCurrentHomeEnergyTariffUseCase,
    CreateHomeEnergyTariffUseCase,
    {
      provide: HomeEnergyTariffRepository,
      useClass: PrismaHomeEnergyTariffRepository,
    },
  ],
})
export class EnergyModule {}
