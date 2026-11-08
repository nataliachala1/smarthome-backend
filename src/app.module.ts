import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { validateRuntimeConfig } from './config/runtime-config';
import { PrismaModule } from './infrastructure/database/prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { HomesModule } from './modules/homes/homes.module';
import { DevicesModule } from './modules/devices/devices.module';
import { ConsumptionModule } from './modules/consumption/consumption.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AdminModule } from './modules/admin/admin.module';
import { EnergyModule } from './modules/energy/energy.module';
import { RateLimitModule } from './security/rate-limit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateRuntimeConfig,
    }),

    RateLimitModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    HomesModule,
    ConsumptionModule,
    DevicesModule,
    NotificationsModule,
    RealtimeModule,
    EnergyModule,
    AdminModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
