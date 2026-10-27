import { Module } from '@nestjs/common';
import { ShellyMqttPrepareController } from './presentation/controllers/shelly-mqtt-prepare.controller';
import { ShellyMqttBootstrapController } from './presentation/controllers/shelly-mqtt-bootstrap.controller';
import { ShellyMqttEnableController } from './presentation/controllers/shelly-mqtt-enable.controller';
import { shellyMqttDevProviders, shellyMqttPgDevProviders } from './infrastructure/messaging/shelly-mqtt-dev.providers';
import { shellyMqttAuthDevProviders, shellyMqttAuthPgDevProviders } from './infrastructure/messaging/shelly-mqtt-auth-dev.providers';
import { selectShellyMqttProviderPlan } from './infrastructure/messaging/shelly-mqtt-deployment-mode';

import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';

import { DeviceRepository } from './domain/repositories/device.repository';
import { DeviceControlPublisher } from './domain/services/device-control-publisher';

import { PrismaDeviceRepository } from './infrastructure/persistence/prisma-device.repository';

import { MqttDeviceControlPublisher } from './infrastructure/messaging/mqtt-device-control.publisher';
import { MqttDeviceStatusSubscriber } from './infrastructure/messaging/mqtt-device-status.subscriber';
import { MqttRuntimeService } from './infrastructure/messaging/mqtt-runtime.service';

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
import { ShellyPairingSessionService } from './application/services/shelly-pairing-session.service';

import { DevicesController } from './presentation/controllers/devices.controller';
import { ShellyController } from './presentation/controllers/shelly.controller';

import { DeviceOfflineWatcherService } from './infrastructure/watchers/device-offline-watcher.service';

// Se decide una sola vez al cargar el modulo. Nunca a partir de HTTP.
const shellyMqttPlan = selectShellyMqttProviderPlan();

@Module({
  imports: [AuthModule, RealtimeModule],

  controllers: [
    DevicesController,
    ShellyController,
    ...(shellyMqttPlan.localWorkflow &&
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP === 'true'
      ? [ShellyMqttBootstrapController, ShellyMqttEnableController] : []),
    // Endpoint controlado: no existe fuera del entorno development+opt-in.
    ...(shellyMqttPlan.localWorkflow
      ? [ShellyMqttPrepareController]
      : []),
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
    MqttRuntimeService,
    DeviceOfflineWatcherService,

    IdentifyShellyDeviceUseCase,
    ShellyRpcClientService,
    ProvisionShellyDeviceUseCase,
    DiscoverShellyDevicesUseCase,
    ShellyPairingSessionService,
    ShellyDiscoveryService,

    // Local: mantiene los coordinadores de laboratorio existentes.
    ...(shellyMqttPlan.localWorkflow ? shellyMqttDevProviders : []),
    // VPS DEV: SOLO cuatro gateways PG (reserver, lease, confirmer, secret).
    ...(shellyMqttPlan.vpsPgOnly ? shellyMqttPgDevProviders : []),

    // Los dos gateways PG de autenticacion requieren un segundo opt-in.
    // En VPS no se registra el worker, transport MQTT ni administrador broker.
    ...(shellyMqttPlan.localAuthWorker ? shellyMqttAuthDevProviders : []),
    ...(shellyMqttPlan.vpsAuthPgOnly ? shellyMqttAuthPgDevProviders : []),

    {
      provide: DeviceControlPublisher,
      useClass: MqttDeviceControlPublisher,
    },

    {
      provide: DeviceRepository,
      useClass: PrismaDeviceRepository,
    },
  ],

  exports: [DeviceRepository],
})
export class DevicesModule {}
