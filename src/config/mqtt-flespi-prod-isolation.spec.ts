import { parseMqttConfig } from './mqtt-config';

const host = 'smart-home-smarthomepostgres-l3s1t5';
const base = () => ({
  NODE_ENV: 'production',
  APP_ENV: 'production',
  MQTT_ENABLED: 'true',
  MQTT_BROKER_PROVIDER: 'flespi',
  MQTT_BROKER_URL: 'mqtts://mqtt.flespi.io:8883',
  MQTT_TOPIC_NAMESPACE: 'smarthome/dev/v1',
  MQTT_FLESPI_DEVICE_ID: 'shelly1pmg4-d885acf06990',
  MQTT_USERNAME: 'synthetic-test-token',
  FLESPI_MQTT_PROD_TEMP_ENABLED: 'true',
  FLESPI_MQTT_PROD_CONTROL_ENABLED: 'false',
  FLESPI_MQTT_PROD_HANDOFF_ACK: 'false',
  FLESPI_MQTT_PROD_ADOPTION_ENABLED: 'false',
  FLESPI_MQTT_PROD_DATABASE_HOST: host,
  DATABASE_URL: `postgresql://app:synthetic@${host}:5432/smarthome?sslmode=verify-full`,
  DATABASE_IOT_URL: `postgresql://iot:synthetic@${host}:5432/smarthome?sslmode=verify-full`,
});

describe('Temporary Flespi PROD database isolation and adoption gate', () => {
  it('accepts pinned production host and distinct DB users', () => {
    expect(parseMqttConfig(base()).flespiProduction).toBe(true);
  });

  it.each([
    { name: 'unapproved hostname', data: { FLESPI_MQTT_PROD_DATABASE_HOST: 'arbitrary' } },
    { name: 'port mismatch', data: { DATABASE_IOT_URL: `postgresql://iot:synthetic@${host}:5433/smarthome?sslmode=verify-full` } },
    { name: 'same login', data: { DATABASE_IOT_URL: `postgresql://app:synthetic@${host}:5432/smarthome?sslmode=verify-full` } },
    { name: 'missing verification', data: { DATABASE_URL: `postgresql://app:synthetic@${host}:5432/smarthome?sslmode=require` } },
    { name: 'unexpected URL parameter', data: { DATABASE_URL: `postgresql://app:synthetic@${host}:5432/smarthome?sslmode=verify-full&application_name=extra` } },
  ])('rejects $name', ({ data }) => {
    expect(() => parseMqttConfig({ ...base(), ...data })).toThrow('MQTT_FLESPI_PROD_ISOLATION_INVALID');
  });

  it('requires handoff before allowing temporary adoption', () => {
    expect(() => parseMqttConfig({ ...base(), FLESPI_MQTT_PROD_ADOPTION_ENABLED: 'true' }))
      .toThrow('MQTT_FLESPI_PROD_ADOPTION_HANDOFF_REQUIRED');
    expect(parseMqttConfig({
      ...base(),
      FLESPI_MQTT_PROD_HANDOFF_ACK: 'true',
      FLESPI_MQTT_PROD_ADOPTION_ENABLED: 'true',
    }).flespiProduction).toBe(true);
  });
});
