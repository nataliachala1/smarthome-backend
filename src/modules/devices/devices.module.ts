import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';

import { DeviceRepository } from './domain/repositories/device.repository';
import { DeviceControlPublisher } from './domain/services/device-control-publisher';

import { PrismaDeviceRepository } from './infrastructure/persistence/prisma-device.repository';

import { MqttDeviceControlPublisher } from './infrastructure/messaging/mqtt-device-control.publisher';
import { MqttDeviceStatusSubscriber } from './infrastructure/messaging/mqtt-device-status.subscriber';

import { ShellyRpcClientService } from './infrastructure/shelly/shelly-rpc-client.service';
import { ShellyDiscoveryService } from './infrastructure/shelly/shelly-discovery.service';

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

import { DevicesController } from './presentation/controllers/devices.controller';
import { ShellyController } from './presentation/controllers/shelly.controller';

import { DeviceOfflineWatcherService } from './infrastructure/watchers/device-offline-watcher.service';

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
  ],

  controllers: [
    DevicesController,
    ShellyController,
  ],

  providers: [
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
    DeviceOfflineWatcherService,

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
      provide: DeviceRepository,
      useClass: PrismaDeviceRepository,
    },
  ],

  exports: [
    DeviceRepository,
  ],
})
export class DevicesModule {}