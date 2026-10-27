import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MqttAuthenticationPgGateway, openMqttAuthPgGateway } from '../persistence/mqtt-authentication-pg.gateway';
import { PgMqttRpcChallengePort, PgMqttAuthConfirmPort } from '../persistence/pg-mqtt-authentication.ports';
import { ShellyMqttAuthenticationWorker } from '../../application/services/shelly-mqtt-authentication.worker';
import { ShellyMqttRpcChallengeTransport } from './shelly-mqtt-rpc-challenge.transport';
import { MqttRuntimeService } from './mqtt-runtime.service';
import { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import { requireShellyMqttDeploymentMode } from './shelly-mqtt-deployment-mode';

export const MQTT_RPC_AUTH_GATEWAY = Symbol('MQTT_RPC_AUTH_GATEWAY');
export const MQTT_CONFIRM_AUTH_GATEWAY = Symbol('MQTT_CONFIRM_AUTH_GATEWAY');

/**
 * Solo DI dev y SIN endpoints, cron, autoejecución ni MQTT físico. El worker
 * queda disponible para un orquestador interno futuro tras activar SQL029.
 */
export const shellyMqttAuthDevProviders: Provider[] = [
  {
    provide: MQTT_RPC_AUTH_GATEWAY,
    inject: [ConfigService],
    useFactory: (c: ConfigService) => openMqttAuthPgGateway(
      c.get<string>('MQTT_RPC_DATABASE_URL'), 'rpc', requireShellyMqttDeploymentMode(),
    ),
  },
  {
    provide: MQTT_CONFIRM_AUTH_GATEWAY,
    inject: [ConfigService],
    useFactory: (c: ConfigService) => openMqttAuthPgGateway(
      c.get<string>('MQTT_AUTH_DATABASE_URL'), 'confirm', requireShellyMqttDeploymentMode(),
    ),
  },
  {
    provide: PgMqttRpcChallengePort,
    inject: [MQTT_RPC_AUTH_GATEWAY],
    useFactory: (db: MqttAuthenticationPgGateway) => new PgMqttRpcChallengePort(db),
  },
  {
    provide: PgMqttAuthConfirmPort,
    inject: [MQTT_CONFIRM_AUTH_GATEWAY],
    useFactory: (db: MqttAuthenticationPgGateway) => new PgMqttAuthConfirmPort(db),
  },
  {
    provide: ShellyMqttRpcChallengeTransport,
    inject: [MqttRuntimeService],
    useFactory: (runtime: MqttRuntimeService) => new ShellyMqttRpcChallengeTransport(runtime),
  },
  {
    provide: ShellyMqttAuthenticationWorker,
    inject: [PgMqttRpcChallengePort, PgMqttAuthConfirmPort,
      MqttDeviceIdentityProvider, ShellyMqttRpcChallengeTransport, MqttRuntimeService],
    useFactory: (
      rpc: PgMqttRpcChallengePort,
      auth: PgMqttAuthConfirmPort,
      broker: MqttDeviceIdentityProvider,
      transport: ShellyMqttRpcChallengeTransport,
      runtime: MqttRuntimeService,
    ) => new ShellyMqttAuthenticationWorker(
      rpc, auth, broker, transport, runtime.topics, runtime.config.switchId,
    ),
  },
];
