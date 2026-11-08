import { parseMqttConfig, MQTT_SETTINGS } from './mqtt-config';

const host = 'smart-home-smarthomepostgresdev-vrmtpz';
const db = (database = 'smarthome_dev', hostname = host) =>
  `postgresql://dev_user:synthetic-password@${hostname}:5432/${database}`;
const enabled = () => ({
  NODE_ENV: 'production',
  APP_ENV: 'development',
  DATABASE_URL: db(),
  DATABASE_IOT_URL: db(),
  MQTT_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_BROKER_HOST: 'mosquitto-dev.internal',
  MQTT_BROKER_URL: 'mqtts://mosquitto-dev.internal:8883',
  MQTT_TLS_CA_FILE: '/run/secrets/mosquitto-dev-ca.pem',
  MQTT_USERNAME: 'synthetic-service',
  MQTT_PASSWORD: 'synthetic-password',
  MQTT_TOPIC_NAMESPACE: 'smarthome/dev/v1',
});

describe('VPS DEV: isolated MQTT TLS transport without endpoints', () => {
  it('allows only an explicit DEV configuration with TLS and namespace', () => {
    const parsed = parseMqttConfig(enabled());
    expect(parsed.brokerUrl).toBe('mqtts://mosquitto-dev.internal:8883');
    expect(parsed.tls).toBe(true);
    expect(parsed.devicePrefix).toBe('smarthome/dev/v1/devices');
  });

  it('makes every flag visible to the ConfigService of the MQTT runtime', () => {
    expect(MQTT_SETTINGS).toEqual(expect.arrayContaining([
      'APP_ENV', 'DATABASE_URL', 'DATABASE_IOT_URL',
      'SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED',
      'SHELLY_MQTT_VPS_DEV_TLS_ENABLED',
      'SHELLY_MQTT_VPS_DEV_BROKER_HOST',
      'SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL',
      'SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE',
    ]));
  });

  it.each([
    { SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: undefined },
    { SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'false' },
    { APP_ENV: 'production' },
    { NODE_ENV: 'development' },
    { DATABASE_URL: db('smarthome') },
    { DATABASE_IOT_URL: db('smarthome') },
    { DATABASE_URL: db('smarthome_dev', 'other-postgres') },
  ])('rejects enabling with incompatible parameters: %j', (override) => {
    expect(() => parseMqttConfig({ ...enabled(), ...override })).toThrow();
  });

  it.each([
    { MQTT_BROKER_URL: 'mqtt://mosquitto-dev.internal:1883' },
    { MQTT_BROKER_URL: 'mqtts://other-broker.internal:8883' },
    { SHELLY_MQTT_VPS_DEV_BROKER_HOST: undefined },
    { MQTT_TLS_CA_FILE: undefined },
    { MQTT_TOPIC_NAMESPACE: 'smarthome/production/v1' },
    { MQTT_TOPIC_NAMESPACE: 'smarthome/staging/v1' },
  ])('impide conectarse a otro broker o namespace: %j', (override) => {
    expect(() => parseMqttConfig({ ...enabled(), ...override })).toThrow();
  });

  it('keeps MQTT off and without a client in VPS DEV PG-only', () => {
    const values = { ...enabled(), MQTT_ENABLED: 'false',
      SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'false' };
    expect(parseMqttConfig(values).brokerUrl).toBeUndefined();
  });

  it('rejects implicit MQTT when no flag is defined in VPS DEV', () => {
    expect(() => parseMqttConfig({ ...enabled(), MQTT_ENABLED: undefined }))
      .toThrow('MQTT_VPS_DEV_EXPLICIT_FLAG_REQUIRED');
  });

  it('keeps the traditional MQTT configuration outside APP_ENV DEV', () => {
    const values = { ...enabled(), APP_ENV: 'production',
      SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'false' };
    expect(parseMqttConfig(values).tls).toBe(true);
  });
});
