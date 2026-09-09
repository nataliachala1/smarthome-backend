import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './infrastructure/database/prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { HomesModule } from './modules/homes/homes.module';
import { DevicesModule } from './modules/devices/devices.module';
import { ConsumptionModule } from './modules/consumption/consumption.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),

    PrismaModule,
    HealthModule,
    AuthModule,
    HomesModule,
    ConsumptionModule,
    DevicesModule,
  ],
})
export class AppModule {}
