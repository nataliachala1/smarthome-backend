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
import { DeviceControlPublisher } from './domain/services/device-control-publisher';
import { MqttDeviceControlPublisher } from './infrastructure/messaging/mqtt-device-control.publisher';
import { ControlDeviceUseCase } from './application/use-cases/control-device.use-case';
import { MqttDeviceStatusSubscriber } from './infrastructure/messaging/mqtt-device-status.subscriber';

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
    ControlDeviceUseCase,
    MqttDeviceStatusSubscriber,

    {
      provide: DeviceControlPublisher,
      useClass: MqttDeviceControlPublisher,
    },

    {
      provide: DeviceTypeRepository,
      useClass: PrismaDeviceTypeRepository,
    },

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
