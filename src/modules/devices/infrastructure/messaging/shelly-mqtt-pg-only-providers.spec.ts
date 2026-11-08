jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('../../application/services/shelly-pairing-session.service', () => ({ ShellyPairingSessionService: class ShellyPairingSessionService {} }));

import {
  MQTT_LEASE_GATEWAY,
  MQTT_CONFIRMER_GATEWAY,
  shellyMqttPgDevProviders,
  shellyMqttDevProviders,
  shellyMqttVpsPairingProviders,
  shellyMqttVpsBootstrapProviders,
} from './shelly-mqtt-dev.providers';
import {
  MQTT_RPC_AUTH_GATEWAY,
  MQTT_CONFIRM_AUTH_GATEWAY,
  shellyMqttAuthPgDevProviders,
  shellyMqttAuthDevProviders,
  shellyMqttVpsAuthWorkerProviders,
} from './shelly-mqtt-auth-dev.providers';
import {
  MQTT_REVOCATION_GATEWAY,
  ShellyMqttRevocationLifecycle,
  shellyMqttVpsRevocationProviders,
} from './shelly-mqtt-revocation.providers';
import { MqttRevocationLoop } from '../../application/services/mqtt-revocation.loop';
import { MqttRevocationWorker } from '../../application/services/mqtt-revocation.worker';
import { ShellyMqttRevocationBroker } from './shelly-mqtt-revocation-broker';
import { MqttReserverPgGateway } from '../persistence/mqtt-reserver-pg.gateway';
import { MqttSecretPgGateway } from '../persistence/mqtt-secret-pg.gateway';
import { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import { ShellyMqttPreparationCoordinator } from '../../application/services/shelly-mqtt-preparation.coordinator';
import { ShellyMqttAuthenticationWorker } from '../../application/services/shelly-mqtt-authentication.worker';
import { ShellyMqttBootstrapAction } from '../../application/services/shelly-mqtt-bootstrap.action';
import { ShellyMqttAuthenticationAction } from '../../application/services/shelly-mqtt-authentication.action';
import { PgMqttPrivilegedReservationPort } from '../persistence/pg-mqtt-privileged-reservation.port';
import { PgMqttPreparationLeasePort } from '../persistence/pg-mqtt-preparation-lease.port';
import { PgMqttPreparedConfirmationPort } from '../persistence/pg-mqtt-prepared-confirmation.port';
import { PgMqttPreparationSecretRepository } from '../secrets/pg-mqtt-preparation-secret.repository';
import { EncryptedMqttPreparationSecretPort } from '../secrets/encrypted-mqtt-preparation-secret.port';
import { ShellyMqttReservationCoordinator } from '../../application/services/shelly-mqtt-reservation.coordinator';
import { ShellyMqttPrepareAction } from '../../application/services/shelly-mqtt-prepare.action';
import { ShellyMqttEnableCoordinator } from '../../application/services/shelly-mqtt-enable.coordinator';
import { PgMqttBootstrapPort } from '../persistence/pg-mqtt-bootstrap.port';
import { PgMqttRevocationPort } from '../persistence/pg-mqtt-revocation.port';

// No factory runs and no Pool/Mosquitto is created.
const tokens = (providers: readonly unknown[]): unknown[] =>
  providers.map((provider) =>
    (provider as { provide?: unknown }).provide,
  );

describe('VPS DEV: isolate SQL from the MQTT broker', () => {
  it('registra exactamente 4 conexiones PostgreSQL independientes', () => {
    expect(tokens(shellyMqttPgDevProviders)).toEqual([
      MqttReserverPgGateway,
      MQTT_LEASE_GATEWAY,
      MQTT_CONFIRMER_GATEWAY,
      MqttSecretPgGateway,
    ]);
    expect(tokens(shellyMqttPgDevProviders)).not.toContain(MqttDeviceIdentityProvider);
    expect(tokens(shellyMqttPgDevProviders)).not.toContain(ShellyMqttPreparationCoordinator);
  });

  it('adds exactly 2 SQL connections for auth without registering a worker', () => {
    expect(tokens(shellyMqttAuthPgDevProviders)).toEqual([
      MQTT_RPC_AUTH_GATEWAY,
      MQTT_CONFIRM_AUTH_GATEWAY,
    ]);
    expect(tokens(shellyMqttAuthPgDevProviders)).not.toContain(ShellyMqttAuthenticationWorker);
  });

  it('registers the VPS worker and its HTTP wrapper only in the explicit group', () => {
    const workerTokens = tokens(shellyMqttVpsAuthWorkerProviders);
    expect(workerTokens).toContain(ShellyMqttAuthenticationWorker);
    expect(workerTokens).toContain(ShellyMqttAuthenticationAction);
    expect(workerTokens).not.toContain(MqttDeviceIdentityProvider);
    expect(workerTokens).not.toContain(MqttReserverPgGateway);
    expect(new Set(workerTokens).size).toBe(workerTokens.length);
  });

  it('keeps the local set and its authentication worker separate', () => {
    expect(tokens(shellyMqttDevProviders)).toContain(ShellyMqttPreparationCoordinator);
    expect(tokens(shellyMqttDevProviders)).toContain(MqttDeviceIdentityProvider);
    expect(tokens(shellyMqttAuthDevProviders)).toContain(ShellyMqttAuthenticationWorker);
  });

  it('separates the VPS orchestration set from the local SQL and bootstrap', () => {
    const vpsTokens = tokens(shellyMqttVpsPairingProviders);
    expect(vpsTokens).toEqual(expect.arrayContaining([
      PgMqttPrivilegedReservationPort,
      PgMqttPreparationLeasePort,
      PgMqttPreparedConfirmationPort,
      PgMqttPreparationSecretRepository,
      EncryptedMqttPreparationSecretPort,
      MqttDeviceIdentityProvider,
      ShellyMqttReservationCoordinator,
      ShellyMqttPreparationCoordinator,
      ShellyMqttPrepareAction,
      ShellyMqttEnableCoordinator,
    ]));
    expect(vpsTokens).not.toContain(MqttReserverPgGateway);
    expect(vpsTokens).not.toContain(MQTT_LEASE_GATEWAY);
    expect(vpsTokens).not.toContain(MQTT_CONFIRMER_GATEWAY);
    expect(vpsTokens).not.toContain(MqttSecretPgGateway);
    expect(vpsTokens).not.toContain(ShellyMqttBootstrapAction);
    expect(vpsTokens).not.toContain(ShellyMqttAuthenticationWorker);
    expect(new Set(vpsTokens).size).toBe(vpsTokens.length);
  });

  it('isolates the VPS bootstrap from the lab-only bootstrap and enable', () => {
    const bootstrapTokens = tokens(shellyMqttVpsBootstrapProviders);
    expect(bootstrapTokens).toEqual([
      PgMqttBootstrapPort,
      ShellyMqttBootstrapAction,
    ]);
    expect(bootstrapTokens).not.toContain(ShellyMqttAuthenticationWorker);
    expect(bootstrapTokens).not.toContain(MqttDeviceIdentityProvider);
    expect(new Set(bootstrapTokens).size).toBe(bootstrapTokens.length);
  });

  it('registers the revocation consumer in a separate, minimum-scope group', () => {
    expect(tokens(shellyMqttVpsRevocationProviders)).toEqual([
      MQTT_REVOCATION_GATEWAY,
      PgMqttRevocationPort,
      ShellyMqttRevocationBroker,
      MqttRevocationWorker,
      MqttRevocationLoop,
      ShellyMqttRevocationLifecycle,
    ]);
    expect(tokens(shellyMqttVpsRevocationProviders)).not.toContain(
      MqttReserverPgGateway,
    );
    expect(tokens(shellyMqttVpsRevocationProviders)).not.toContain(
      ShellyMqttAuthenticationWorker,
    );
  });
});
