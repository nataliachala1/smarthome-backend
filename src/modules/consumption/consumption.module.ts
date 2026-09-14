import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { ListDeviceConsumptionUseCase } from './application/use-cases/list-device-consumption.use-case';
import { ConsumptionController } from './presentation/controllers/consumption.controller';

import { GetDeviceConsumptionSummaryUseCase } from './application/use-cases/get-device-consumption-summary.use-case';
import { GetHomeConsumptionSummaryUseCase } from './application/use-cases/get-home-consumption-summary.use-case';
import { HomeConsumptionController } from './presentation/controllers/home-consumption.controller';
import { ListHomeConsumptionUseCase } from './application/use-cases/list-home-consumption.use-case';

import { GetHomeDailyConsumptionUseCase } from './application/use-cases/get-home-daily-consumption.use-case';
import { GetDeviceDailyConsumptionUseCase } from './application/use-cases/get-device-daily-consumption.use-case';

@Module({
  imports: [AuthModule],
  controllers: [ConsumptionController, HomeConsumptionController],
  providers: [
    ListDeviceConsumptionUseCase, 
    GetDeviceConsumptionSummaryUseCase, 
    GetHomeConsumptionSummaryUseCase,
    ListHomeConsumptionUseCase,
    GetHomeDailyConsumptionUseCase,
    GetDeviceDailyConsumptionUseCase,
  ],
})
export class ConsumptionModule {}