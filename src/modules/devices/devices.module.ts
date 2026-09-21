import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';

import { DeviceTypeRepository } from './domain/repositories/device-type.repository';
import { DeviceRepository } from './domain/repositories/device.repository';
import { DeviceControlPublisher } from './domain/services/device-control-publisher';

import { PrismaDeviceTypeRepository } from './infrastructure/persistence/prisma-device-type.repository';
import { PrismaDeviceRepository } from './infrastructure/persistence/prisma-device.repository';

import { MqttDeviceControlPublisher } from './infrastructure/messaging/mqtt-device-control.publisher';
import { MqttDeviceStatusSubscriber } from './infrastructure/messaging/mqtt-device-status.subscriber';

import { ShellyRpcClientService } from './infrastructure/shelly/shelly-rpc-client.service';
import { ShellyDiscoveryService } from './infrastructure/shelly/shelly-discovery.service';

import { ListDeviceTypesUseCase } from './application/use-cases/list-device-types.use-case';
import { ListHomeDevicesUseCase } from './application/use-cases/list-home-devices.use-case';
import { ListInactiveDevicesUseCase } from './application/use-cases/list-inactive-devices.use-case';

import { CreateDeviceUseCase } from './application/use-cases/create-device.use-case';
import { GetDeviceByIdUseCase } from './application/use-cases/get-device-by-id.use-case';
import { UpdateDeviceUseCase } from './application/use-cases/update-device.use-case';

import { ActivateDeviceUseCase } from './application/use-cases/activate-device.use-case';
import { DeactivateDeviceUseCase } from './application/use-cases/deactivate-device.use-case';
import { DeleteDeviceUseCase } from './application/use-cases/delete-device.use-case';

import { ControlDeviceUseCase } from './application/use-cases/control-device.use-case';

import { ProvisionShellyDeviceUseCase } from './application/use-cases/provision-shelly-device.use-case';
import { IdentifyShellyDeviceUseCase } from './application/use-cases/identify-shelly-device.use-case';
import { DiscoverShellyDevicesUseCase } from './application/use-cases/discover-shelly-devices.use-case';

import { DeviceTypesController } from './presentation/controllers/device-types.controller';
import { DevicesController } from './presentation/controllers/devices.controller';
import { ShellyController } from './presentation/controllers/shelly.controller';

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
  ],

  controllers: [
    DeviceTypesController,
    DevicesController,
    ShellyController,
  ],

  providers: [
    ListDeviceTypesUseCase,
    ListHomeDevicesUseCase,
    ListInactiveDevicesUseCase,

    CreateDeviceUseCase,
    GetDeviceByIdUseCase,
    UpdateDeviceUseCase,

    ActivateDeviceUseCase,
    DeactivateDeviceUseCase,
    DeleteDeviceUseCase,

    ControlDeviceUseCase,

    MqttDeviceStatusSubscriber,

    IdentifyShellyDeviceUseCase,
    ShellyRpcClientService,
    ProvisionShellyDeviceUseCase,
    DiscoverShellyDevicesUseCase,
    ShellyDiscoveryService,

    {
      provide: DeviceControlPublisher,
      useClass: MqttDeviceControlPublisher,
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

  exports: [
    DeviceTypeRepository,
    DeviceRepository,
  ],
})
export class DevicesModule {}