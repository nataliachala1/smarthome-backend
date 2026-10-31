import { Module } from '@nestjs/common';
import { ShellyMqttPrepareController } from './presentation/controllers/shelly-mqtt-prepare.controller';
import { ShellyMqttBootstrapController } from './presentation/controllers/shelly-mqtt-bootstrap.controller';
import { ShellyMqttEnableController } from './presentation/controllers/shelly-mqtt-enable.controller';
import { ShellyMqttAuthenticationController } from './presentation/controllers/shelly-mqtt-authentication.controller';
import {
  shellyMqttDevProviders,
  shellyMqttPgDevProviders,
  shellyMqttVpsPairingProviders,
  shellyMqttVpsBootstrapProviders,
} from './infrastructure/messaging/shelly-mqtt-dev.providers';
import {
  shellyMqttAuthDevProviders,
  shellyMqttAuthPgDevProviders,
  shellyMqttVpsAuthWorkerProviders,
} from './infrastructure/messaging/shelly-mqtt-auth-dev.providers';
import { shellyMqttVpsRevocationProviders } from './infrastructure/messaging/shelly-mqtt-revocation.providers';
import { selectShellyMqttProviderPlan } from './infrastructure/messaging/shelly-mqtt-deployment-mode';

import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';

import { DeviceRepository } from './domain/repositories/device.repository';
import { DeviceControlPublisher } from './domain/services/device-control-publisher';

import { PrismaDeviceRepository } from './infrastructure/persistence/prisma-device.repository';

import { MqttDeviceControlPublisher } from './infrastructure/messaging/mqtt-device-control.publisher';
import { MqttDeviceStatusSubscriber } from './infrastructure/messaging/mqtt-device-status.subscriber';
import { MqttRuntimeService } from './infrastructure/messaging/mqtt-runtime.service';
import { FlespiShellyStatusRpcClient } from './infrastructure/messaging/flespi-shelly-status-rpc.client';
import { FlespiShellyStateReconciler } from './infrastructure/messaging/flespi-shelly-state.reconciler';
import { FlespiShellyStateSyncWorker } from './infrastructure/messaging/flespi-shelly-state-sync.worker';

import { ShellyRpcClientService } from './infrastructure/shelly/shelly-rpc-client.service';
import { ShellyDiscoveryService } from './infrastructure/shelly/shelly-discovery.service';
import {
  ShellyLocalAccessService,
  ShellyLocalGuard,
} from './infrastructure/shelly/shelly-local-access.service';

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

// Polling is strictly opt-in and allowed only on a single-replica VPS DEV
// backed by the single-device flespi ACL. No HTTP input can enable it.
const flespiStateSyncEnabled = process.env.SHELLY_FLESPI_STATE_SYNC_ENABLED === 'true';
if (flespiStateSyncEnabled && (
  process.env.NODE_ENV !== 'production' ||
  process.env.APP_ENV !== 'development' ||
  process.env.MQTT_ENABLED !== 'true' ||
  process.env.MQTT_BROKER_PROVIDER !== 'flespi' ||
  process.env.SHELLY_FLESPI_STATE_SYNC_SINGLE_REPLICA !== 'true'
)) {
  throw new Error('SHELLY_FLESPI_STATE_SYNC_DEV_ONLY');
}
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
    // VPS DEV expone preparación y bootstrap solo bajo el perfil TLS validado.
    ...(shellyMqttPlan.vpsPairing
      ? [ShellyMqttPrepareController, ShellyMqttBootstrapController]
      : []),
    // Enable y prueba MQTT requieren el opt-in adicional del worker aislado.
    ...(shellyMqttPlan.vpsAuthWorker
      ? [ShellyMqttEnableController, ShellyMqttAuthenticationController]
      : []),
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
    FlespiShellyStatusRpcClient,
    FlespiShellyStateReconciler,
    ...(flespiStateSyncEnabled ? [FlespiShellyStateSyncWorker] : []),
    DeviceOfflineWatcherService,

    IdentifyShellyDeviceUseCase,
    ShellyRpcClientService,
    ShellyLocalAccessService,
    ShellyLocalGuard,
    ProvisionShellyDeviceUseCase,
    DiscoverShellyDevicesUseCase,
    ShellyPairingSessionService,
    ShellyDiscoveryService,

    // Local: mantiene los coordinadores de laboratorio existentes.
    ...(shellyMqttPlan.localWorkflow ? shellyMqttDevProviders : []),
    // Base VPS DEV: cuatro gateways PG especializados.
    ...(shellyMqttPlan.vpsPgOnly ? shellyMqttPgDevProviders : []),
    // VPS pairing: servicios internos bajo opt-in y precondiciones estrictas.
    // Los controllers y el worker de autenticacion siguen fuera de este perfil.
    ...(shellyMqttPlan.vpsPairing ? shellyMqttVpsPairingProviders : []),
    ...(shellyMqttPlan.vpsPairing ? shellyMqttVpsBootstrapProviders : []),
    ...(shellyMqttPlan.vpsRevocationWorker
      ? shellyMqttVpsRevocationProviders
      : []),

    // Auth SQL requires its opt-in; VPS adds the worker only with a separate
    // worker opt-in and the already validated VPS pairing profile.
    ...(shellyMqttPlan.localAuthWorker ? shellyMqttAuthDevProviders : []),
    ...(shellyMqttPlan.vpsAuthWorker
      ? shellyMqttVpsAuthWorkerProviders
      : shellyMqttPlan.vpsAuthPgOnly ? shellyMqttAuthPgDevProviders : []),

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
