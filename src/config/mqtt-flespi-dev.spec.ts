import { MQTT_SETTINGS, parseMqttConfig } from './mqtt-config';

const db = 'postgresql://dev_user:synthetic-password@smart-home-smarthomepostgresdev-vrmtpz:5432/smarthome_dev';
const base = () => ({
  NODE_ENV: 'production',
  APP_ENV: 'development',
  DATABASE_URL: db,
  DATABASE_IOT_URL: db,
  MQTT_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_BROKER_HOST: 'mqtt.flespi.io',
  MQTT_BROKER_PROVIDER: 'flespi',
  MQTT_BROKER_URL: 'mqtts://mqtt.flespi.io:8883',
  MQTT_USERNAME: 'FlespiToken synthetic-only-not-a-secret',
  MQTT_TOPIC_NAMESPACE: 'smarthome/dev/v1',
});

describe('Flespi MQTT: transporte aislado en VPS DEV', () => {
  it('admite token ACL solo como username, sin password ni CA privada', () => {
    const c = parseMqttConfig(base());
    expect(c.brokerUrl).toBe('mqtts://mqtt.flespi.io:8883');
    expect(c.tls).toBe(true);
    expect(c.password).toBeUndefined();
    expect(c.caFile).toBeUndefined();
    expect(c.namespace).toBe('smarthome/dev/v1');
    expect(MQTT_SETTINGS).toContain('MQTT_BROKER_PROVIDER');
    expect(c.username).toBe(base().MQTT_USERNAME);
    expect(c.controlClientId).toBeUndefined();
    expect(c.statusClientId).toBeUndefined();
  });

  const invalid: Array<{ override: Record<string, string>; error: string }> = [
    { override: { MQTT_BROKER_URL: 'mqtt://mqtt.flespi.io:1883' }, error: 'MQTT_FLESPI_BROKER_NOT_ALLOWED' },
    { override: { MQTT_BROKER_URL: 'mqtts://another.example:8883' }, error: 'MQTT_FLESPI_BROKER_NOT_ALLOWED' },
    { override: { SHELLY_MQTT_VPS_DEV_BROKER_HOST: 'mosquitto-dev.internal' }, error: 'MQTT_VPS_DEV_BROKER_NOT_ALLOWED' },
    { override: { MQTT_PASSWORD: 'wrong' }, error: 'MQTT_FLESPI_TOKEN_AUTH_REQUIRED' },
    { override: { MQTT_USERNAME: '' }, error: 'MQTT_FLESPI_TOKEN_AUTH_REQUIRED' },
    { override: { MQTT_TLS_CA_FILE: '/run/secrets/mosquitto.pem' }, error: 'MQTT_FLESPI_SYSTEM_TRUST_REQUIRED' },
    { override: { APP_ENV: 'production' }, error: 'MQTT_FLESPI_DEV_MODE_NOT_ALLOWED' },
    { override: { MQTT_ENABLED: 'false' }, error: 'MQTT_FLESPI_DEV_MODE_NOT_ALLOWED' },
    { override: { MQTT_BROKER_PROVIDER: 'unknown' }, error: 'MQTT_BROKER_PROVIDER_INVALID' },
    { override: { MQTT_TLS_REJECT_UNAUTHORIZED: 'false' }, error: 'No se permite desactivar' },
  ];
  it.each(invalid)('rechaza configuracion insegura: %p', ({ override, error }) => {
    expect(() => parseMqttConfig({ ...base(), ...override })).toThrow(error);
  });

  it('no altera el comportamiento del broker Mosquitto sin opt-in', () => {
    const e = {
      ...base(),
      MQTT_BROKER_PROVIDER: 'mosquitto',
      SHELLY_MQTT_VPS_DEV_BROKER_HOST: 'mosquitto-dev.internal',
      MQTT_BROKER_URL: 'mqtts://mosquitto-dev.internal:8883',
      MQTT_USERNAME: 'synthetic-service',
      MQTT_PASSWORD: 'synthetic-password',
      MQTT_TLS_CA_FILE: '/run/secrets/mosquitto-ca.pem',
    };
    expect(parseMqttConfig(e).brokerUrl).toBe(e.MQTT_BROKER_URL);
  });
});
