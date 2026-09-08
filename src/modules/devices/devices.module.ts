import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { DeviceTypeRepository } from './domain/repositories/device-type.repository';
import { DeviceRepository } from './domain/repositories/device.repository';

import { PrismaDeviceTypeRepository } from './infrastructure/persistence/prisma-device-type.repository';
import { PrismaDeviceRepository } from './infrastructure/persistence/prisma-device.repository';

import { ListDeviceTypesUseCase } from './application/use-cases/list-device-types.use-case';
import { ListHomeDevicesUseCase } from './application/use-cases/list-home-devices.use-case';
import { GetDeviceByIdUseCase } from './application/use-cases/get-device-by-id.use-case';
import { UpdateDeviceUseCase } from './application/use-cases/update-device.use-case';
import { DeactivateDeviceUseCase } from './application/use-cases/deactivate-device.use-case';

import { DeviceTypesController } from './presentation/controllers/device-types.controller';
import { DevicesController } from './presentation/controllers/devices.controller';
import { CreateDeviceUseCase } from './application/use-cases/create-device.use-case';

@Module({
  imports: [AuthModule],

  controllers: [DeviceTypesController, DevicesController],

  providers: [
    ListDeviceTypesUseCase,
    ListHomeDevicesUseCase,
    CreateDeviceUseCase,
    GetDeviceByIdUseCase,
    UpdateDeviceUseCase,
    DeactivateDeviceUseCase,

    {
      provide: DeviceTypeRepository,
      useClass: PrismaDeviceTypeRepository,
    },

    {
      provide: DeviceRepository,
      useClass: PrismaDeviceRepository,
    },
  ],

  exports: [DeviceTypeRepository, DeviceRepository],
})
export class DevicesModule {}
