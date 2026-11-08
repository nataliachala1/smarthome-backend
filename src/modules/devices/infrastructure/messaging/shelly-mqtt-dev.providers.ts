import { ShellyMqttBootstrapAction } from '../../application/services/shelly-mqtt-bootstrap.action';
import { PgMqttBootstrapPort } from '../persistence/pg-mqtt-bootstrap.port';
import { ShellyMqttEnableCoordinator } from '../../application/services/shelly-mqtt-enable.coordinator';
import { PgMqttEnablePort } from '../persistence/pg-mqtt-enable.port';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShellyMqttReservationCoordinator } from '../../application/services/shelly-mqtt-reservation.coordinator';
import { ShellyMqttPreparationCoordinator } from '../../application/services/shelly-mqtt-preparation.coordinator';
import { ShellyMqttPrepareAction } from '../../application/services/shelly-mqtt-prepare.action';
import { ShellyPairingSessionService } from '../../application/services/shelly-pairing-session.service';
import { MqttRuntimeService } from './mqtt-runtime.service';
import { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import { MosquittoDynamicSecurityProvider } from './mosquitto-dynamic-security.provider';
import { MqttReserverPgGateway, openMqttReserverPgGateway } from '../persistence/mqtt-reserver-pg.gateway';
import { MqttWorkerPgGateway, openMqttWorkerPgGateway } from '../persistence/mqtt-worker-pg.gateway';
import { MqttSecretPgGateway, openMqttSecretPgGateway } from '../persistence/mqtt-secret-pg.gateway';
import { requireShellyMqttDeploymentMode } from './shelly-mqtt-deployment-mode';
import { PgMqttPrivilegedReservationPort } from '../persistence/pg-mqtt-privileged-reservation.port';
import { PgMqttPreparationLeasePort } from '../persistence/pg-mqtt-preparation-lease.port';
import { PgMqttPreparedConfirmationPort } from '../persistence/pg-mqtt-prepared-confirmation.port';
import { PgMqttPreparationSecretRepository } from '../secrets/pg-mqtt-preparation-secret.repository';
import { EncryptedMqttPreparationSecretPort } from '../secrets/encrypted-mqtt-preparation-secret.port';

// Independent tokens: sharing a pool between both roles would violate SQL025/027.
export const MQTT_LEASE_GATEWAY = Symbol('MQTT_LEASE_GATEWAY');
export const MQTT_CONFIRMER_GATEWAY = Symbol('MQTT_CONFIRMER_GATEWAY');

function requireMqttDatabaseMode(): 'local-dev' | 'vps-dev-tls' | 'production' {
  const mode = requireShellyMqttDeploymentMode();
  return mode === 'production-mosquitto' ? 'production' : mode;
}

/**
 * VPS DEV base: only specialized PostgreSQL gateways. Their factories
 * validate account, target, TLS and privileges. The mode requires opt-in.
 */
export const shellyMqttPgDevProviders: Provider[] = [
  {
    provide: MqttReserverPgGateway,
    inject: [ConfigService],
    useFactory: (c: ConfigService) => openMqttReserverPgGateway(
      c.get<string>('MQTT_RESERVER_DATABASE_URL'), requireMqttDatabaseMode(),
    ),
  },
  {
    provide: MQTT_LEASE_GATEWAY,
    inject: [ConfigService],
    useFactory: (c: ConfigService) => openMqttWorkerPgGateway(
      c.get<string>('MQTT_LEASE_DATABASE_URL'), 'lease', requireMqttDatabaseMode(),
    ),
  },
  {
    provide: MQTT_CONFIRMER_GATEWAY,
    inject: [ConfigService],
    useFactory: (c: ConfigService) => openMqttWorkerPgGateway(
      c.get<string>('MQTT_CONFIRMER_DATABASE_URL'), 'confirmer', requireMqttDatabaseMode(),
    ),
  },
  {
    provide: MqttSecretPgGateway,
    inject: [ConfigService],
    useFactory: (c: ConfigService) => openMqttSecretPgGateway(
      c.get<string>('MQTT_SECRET_DATABASE_URL'), requireMqttDatabaseMode(),
    ),
  },
  // The DB-only profile ends here: no MQTT actions or identities are created.
];

/** Legacy local lab flow; keeps the previous behavior. */
export const shellyMqttDevProviders: Provider[] = [
  ...shellyMqttPgDevProviders,
  {
    provide: PgMqttPrivilegedReservationPort,
    inject: [MqttReserverPgGateway],
    useFactory: (gateway: MqttReserverPgGateway) =>
      new PgMqttPrivilegedReservationPort(gateway),
  },
  {
    provide: PgMqttPreparationLeasePort,
    inject: [MQTT_LEASE_GATEWAY],
    useFactory: (gateway: MqttWorkerPgGateway) =>
      new PgMqttPreparationLeasePort(gateway),
  },
  {
    provide: PgMqttPreparedConfirmationPort,
    inject: [MQTT_CONFIRMER_GATEWAY],
    useFactory: (gateway: MqttWorkerPgGateway) =>
      new PgMqttPreparedConfirmationPort(gateway),
  },
  {
    provide: PgMqttPreparationSecretRepository,
    inject: [MqttSecretPgGateway],
    useFactory: (gateway: MqttSecretPgGateway) =>
      new PgMqttPreparationSecretRepository(gateway),
  },
  {
    provide: EncryptedMqttPreparationSecretPort,
    inject: [PgMqttPreparationSecretRepository, ConfigService],
    useFactory: (repository: PgMqttPreparationSecretRepository, c: ConfigService) => {
      const encoded = c.get<string>('MQTT_PREPARATION_AES_KEY_B64URL');
      const id = c.get<string>('MQTT_PREPARATION_AES_KEY_ID');
      const expectedKeyId = requireShellyMqttDeploymentMode() === 'production-mosquitto'
        ? 'prod-mqtt-aes-v1'
        : 'dev-mqtt-aes-v1';
      if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded) ||
          id !== expectedKeyId) {
        throw new Error('MQTT_DEV_PREPARATION_KEY_NOT_READY');
      }
      const material = Buffer.from(encoded, 'base64url');
      if (material.length !== 32 || material.toString('base64url') !== encoded) {
        throw new Error('MQTT_DEV_PREPARATION_KEY_NOT_READY');
      }
      try {
        return new EncryptedMqttPreparationSecretPort(repository, { id, material });
      } finally {
        material.fill(0);
      }
    },
  },
  ...(process.env.NODE_ENV === 'development' &&
  process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP === 'true' ? [
  {
    provide: PgMqttBootstrapPort,
    inject: [MqttSecretPgGateway],
    useFactory: (gateway:MqttSecretPgGateway) => new PgMqttBootstrapPort(gateway),
  },
  {
    provide: ShellyMqttBootstrapAction,
    inject: [
      ShellyPairingSessionService,
      PgMqttBootstrapPort,
      MqttRuntimeService,
      MqttDeviceIdentityProvider,
      ConfigService,
    ],
    useFactory: (
      sessions: ShellyPairingSessionService,
      port: PgMqttBootstrapPort,
      runtime: MqttRuntimeService,
      broker: MqttDeviceIdentityProvider,
      c: ConfigService,
    ) => new ShellyMqttBootstrapAction(
      sessions,
      port,
      runtime,
      broker,
      c.get<string>('MQTT_PREPARATION_AES_KEY_B64URL') ?? '',
      c.get<string>('MQTT_PREPARATION_AES_KEY_ID') ?? '',
      {
        profile: 'local-dev',
        localCaFile: c.get<string>('MQTT_TLS_CA_FILE') ?? '',
      },
    ),
  },
  ] : []),
  { provide: MqttDeviceIdentityProvider, useClass: MosquittoDynamicSecurityProvider },
  {
    provide: ShellyMqttReservationCoordinator,
    inject: [ShellyPairingSessionService, PgMqttPrivilegedReservationPort, MqttRuntimeService],
    useFactory: (
      sessions: ShellyPairingSessionService,
      reservation: PgMqttPrivilegedReservationPort,
      runtime: MqttRuntimeService,
    ) => new ShellyMqttReservationCoordinator(sessions, reservation, runtime),
  },
  {
    provide: ShellyMqttPreparationCoordinator,
    inject: [PgMqttPreparationLeasePort, MqttDeviceIdentityProvider,
      PgMqttPreparedConfirmationPort, EncryptedMqttPreparationSecretPort],
    useFactory: (
      leases: PgMqttPreparationLeasePort,
      broker: MqttDeviceIdentityProvider,
      confirmer: PgMqttPreparedConfirmationPort,
      secrets: EncryptedMqttPreparationSecretPort,
    ) => new ShellyMqttPreparationCoordinator(leases, broker, confirmer, secrets),
  },
  {
    provide: ShellyMqttPrepareAction,
    inject: [ShellyMqttReservationCoordinator, ShellyMqttPreparationCoordinator],
    useFactory: (
      reservation: ShellyMqttReservationCoordinator,
      preparation: ShellyMqttPreparationCoordinator,
    ) => new ShellyMqttPrepareAction(reservation, preparation),
  },
  {
    provide: PgMqttEnablePort,
    inject: [MQTT_LEASE_GATEWAY],
    useFactory: (gateway: MqttWorkerPgGateway) => new PgMqttEnablePort(gateway),
  },
  {
    provide: ShellyMqttEnableCoordinator,
    inject: [ShellyPairingSessionService, PgMqttEnablePort,
      MqttDeviceIdentityProvider, MqttRuntimeService],
    useFactory: (
      sessions: ShellyPairingSessionService,
      port: PgMqttEnablePort,
      broker: MqttDeviceIdentityProvider,
      runtime: MqttRuntimeService,
    ) => new ShellyMqttEnableCoordinator(sessions, port, broker, runtime),
  },
];

/**
 * VPS DEV preparation orchestration. This explicit allowlist strips the SQL
 * gateway factories and the local-only bootstrap action from the local set.
 * It contains no HTTP controllers or authentication worker.
 */
const vpsPairingProviderTokens = new Set<unknown>([
  PgMqttPrivilegedReservationPort,
  PgMqttPreparationLeasePort,
  PgMqttPreparedConfirmationPort,
  PgMqttPreparationSecretRepository,
  EncryptedMqttPreparationSecretPort,
  MqttDeviceIdentityProvider,
  ShellyMqttReservationCoordinator,
  ShellyMqttPreparationCoordinator,
  ShellyMqttPrepareAction,
  PgMqttEnablePort,
]);

function createPairingProviders(
  profile: 'vps-dev-tls' | 'production-mosquitto',
): Provider[] {
  return [
    ...shellyMqttDevProviders.filter((provider) =>
      vpsPairingProviderTokens.has(
        (provider as { provide?: unknown }).provide,
      ),
    ),
    {
      provide: ShellyMqttEnableCoordinator,
      inject: [ShellyPairingSessionService, PgMqttEnablePort,
        MqttDeviceIdentityProvider, MqttRuntimeService],
      useFactory: (
        sessions: ShellyPairingSessionService,
        port: PgMqttEnablePort,
        broker: MqttDeviceIdentityProvider,
        runtime: MqttRuntimeService,
      ) => new ShellyMqttEnableCoordinator(
        sessions, port, broker, runtime, profile,
      ),
    },
  ];
}

export const shellyMqttVpsPairingProviders =
  createPairingProviders('vps-dev-tls');

export const shellyMqttProductionPairingProviders =
  createPairingProviders('production-mosquitto');

/** Bootstrap credentials are delivered only through the separately authorized route. */
function createBootstrapProviders(
  profile: 'vps-dev-tls' | 'production-mosquitto',
): Provider[] {
  const isProduction = profile === 'production-mosquitto';
  return [
  {
    provide: PgMqttBootstrapPort,
    inject: [MqttSecretPgGateway],
    useFactory: (gateway: MqttSecretPgGateway) => new PgMqttBootstrapPort(gateway),
  },
  {
    provide: ShellyMqttBootstrapAction,
    inject: [
      ShellyPairingSessionService,
      PgMqttBootstrapPort,
      MqttRuntimeService,
      MqttDeviceIdentityProvider,
      ConfigService,
    ],
    useFactory: (
      sessions: ShellyPairingSessionService,
      port: PgMqttBootstrapPort,
      runtime: MqttRuntimeService,
      broker: MqttDeviceIdentityProvider,
      c: ConfigService,
    ) => new ShellyMqttBootstrapAction(
      sessions,
      port,
      runtime,
      broker,
      c.get<string>('MQTT_PREPARATION_AES_KEY_B64URL') ?? '',
      c.get<string>('MQTT_PREPARATION_AES_KEY_ID') ?? '',
      {
        profile,
        publicBrokerUrl: c.get<string>(isProduction
          ? 'SHELLY_MQTT_PRODUCTION_DEVICE_BROKER_URL'
          : 'SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL'),
        publicCaFile: c.get<string>(isProduction
          ? 'SHELLY_MQTT_PRODUCTION_DEVICE_CA_FILE'
          : 'SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE'),
        adminCaFile: c.get<string>('MQTT_DYNSEC_ADMIN_CA_FILE'),
      },
    ),
  },
  ];
}

export const shellyMqttVpsBootstrapProviders =
  createBootstrapProviders('vps-dev-tls');

export const shellyMqttProductionBootstrapProviders =
  createBootstrapProviders('production-mosquitto');
