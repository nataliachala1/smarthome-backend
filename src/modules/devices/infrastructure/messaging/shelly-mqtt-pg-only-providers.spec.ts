jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('../../application/services/shelly-pairing-session.service', () => ({ ShellyPairingSessionService: class ShellyPairingSessionService {} }));

import {
  MQTT_LEASE_GATEWAY,
  MQTT_CONFIRMER_GATEWAY,
  shellyMqttPgDevProviders,
  shellyMqttDevProviders,
} from './shelly-mqtt-dev.providers';
import {
  MQTT_RPC_AUTH_GATEWAY,
  MQTT_CONFIRM_AUTH_GATEWAY,
  shellyMqttAuthPgDevProviders,
  shellyMqttAuthDevProviders,
} from './shelly-mqtt-auth-dev.providers';
import { MqttReserverPgGateway } from '../persistence/mqtt-reserver-pg.gateway';
import { MqttSecretPgGateway } from '../persistence/mqtt-secret-pg.gateway';
import { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import { ShellyMqttPreparationCoordinator } from '../../application/services/shelly-mqtt-preparation.coordinator';
import { ShellyMqttAuthenticationWorker } from '../../application/services/shelly-mqtt-authentication.worker';

// No se ejecuta ninguna factory ni se crea un Pool/Mosquitto.
const tokens = (providers: readonly unknown[]): unknown[] =>
  providers.map((provider) =>
    (provider as { provide?: unknown }).provide,
  );

describe('VPS DEV: aislar SQL del broker MQTT', () => {
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

  it('agrega exactamente 2 conexiones SQL para auth sin registrar un worker', () => {
    expect(tokens(shellyMqttAuthPgDevProviders)).toEqual([
      MQTT_RPC_AUTH_GATEWAY,
      MQTT_CONFIRM_AUTH_GATEWAY,
    ]);
    expect(tokens(shellyMqttAuthPgDevProviders)).not.toContain(ShellyMqttAuthenticationWorker);
  });

  it('mantiene los coordinadores existentes solo en el conjunto local', () => {
    expect(tokens(shellyMqttDevProviders)).toContain(ShellyMqttPreparationCoordinator);
    expect(tokens(shellyMqttDevProviders)).toContain(MqttDeviceIdentityProvider);
    expect(tokens(shellyMqttAuthDevProviders)).toContain(ShellyMqttAuthenticationWorker);
  });
});
