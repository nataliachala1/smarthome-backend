import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MqttAuthenticationPgGateway, openMqttAuthPgGateway } from '../persistence/mqtt-authentication-pg.gateway';
import { PgMqttRpcChallengePort, PgMqttAuthConfirmPort } from '../persistence/pg-mqtt-authentication.ports';
import { ShellyMqttAuthenticationWorker } from '../../application/services/shelly-mqtt-authentication.worker';
import { ShellyMqttAuthenticationAction } from '../../application/services/shelly-mqtt-authentication.action';
import { ShellyMqttRpcChallengeTransport } from './shelly-mqtt-rpc-challenge.transport';
import { MqttRuntimeService } from './mqtt-runtime.service';
import { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import { ShellyPairingSessionService } from '../../application/services/shelly-pairing-session.service';
import { requireShellyMqttDeploymentMode } from './shelly-mqtt-deployment-mode';

function requireMqttAuthDatabaseMode(): 'local-dev' | 'vps-dev-tls' | 'production' {
  const mode = requireShellyMqttDeploymentMode();
  return mode === 'production-mosquitto' ? 'production' : mode;
}

export const MQTT_RPC_AUTH_GATEWAY = Symbol('MQTT_RPC_AUTH_GATEWAY');
export const MQTT_CONFIRM_AUTH_GATEWAY = Symbol('MQTT_CONFIRM_AUTH_GATEWAY');

/** Only RPC and confirmation SQL connections. Registers no transports or workers. */
export const shellyMqttAuthPgDevProviders: Provider[] = [
  {
    provide: MQTT_RPC_AUTH_GATEWAY,
    inject: [ConfigService],
    useFactory: (c: ConfigService) => openMqttAuthPgGateway(
      c.get<string>('MQTT_RPC_DATABASE_URL'), 'rpc', requireMqttAuthDatabaseMode(),
    ),
  },
  {
    provide: MQTT_CONFIRM_AUTH_GATEWAY,
    inject: [ConfigService],
    useFactory: (c: ConfigService) => openMqttAuthPgGateway(
      c.get<string>('MQTT_AUTH_DATABASE_URL'), 'confirm', requireMqttAuthDatabaseMode(),
    ),
  },
  // The DB-only profile ends here.
];

/** Original local worker; stays without a timer or automatic execution. */
export const shellyMqttAuthDevProviders: Provider[] = [
  ...shellyMqttAuthPgDevProviders,
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

/** VPS worker + HTTP authorization wrapper; only registered under a second opt-in. */
export const shellyMqttVpsAuthWorkerProviders: Provider[] = [
  ...shellyMqttAuthDevProviders,
  {
    provide: ShellyMqttAuthenticationAction,
    inject: [ShellyPairingSessionService, ShellyMqttAuthenticationWorker],
    useFactory: (
      sessions: ShellyPairingSessionService,
      worker: ShellyMqttAuthenticationWorker,
    ) => new ShellyMqttAuthenticationAction(sessions, worker),
  },
];

/** Same isolated auth worker, selected only by the separate production profile. */
export const shellyMqttProductionAuthWorkerProviders =
  shellyMqttVpsAuthWorkerProviders;
