import { parseMqttConfig } from './mqtt-config';

const base = () => ({
  NODE_ENV: 'production',
  APP_ENV: 'production',
  MQTT_ENABLED: 'true',
  MQTT_BROKER_PROVIDER: 'flespi',
  FLESPI_MQTT_PROD_TEMP_ENABLED: 'true',
  FLESPI_MQTT_PROD_CONTROL_ENABLED: 'false',
  FLESPI_MQTT_PROD_HANDOFF_ACK: 'false',
  FLESPI_MQTT_PROD_ADOPTION_ENABLED: 'false',
  FLESPI_MQTT_PROD_DATABASE_HOST: 'smart-home-smarthomepostgres-l3s1t5',
  DATABASE_URL: 'postgresql://app:synthetic@smart-home-smarthomepostgres-l3s1t5:5432/smarthome?sslmode=verify-full',
  DATABASE_IOT_URL: 'postgresql://iot:synthetic@smart-home-smarthomepostgres-l3s1t5:5432/smarthome?sslmode=verify-full',
  MQTT_BROKER_URL: 'mqtts://mqtt.flespi.io:8883',
  MQTT_USERNAME: 'synthetic-test-token',
  MQTT_TOPIC_NAMESPACE: 'smarthome/dev/v1',
  MQTT_FLESPI_DEVICE_ID: 'shelly1pmg4-d885acf06990',
});

describe('Flespi production TEMP mode', () => {
  it('accepts isolated production read-only mode', () => {
    const c = parseMqttConfig(base());
    expect(c.flespiProduction).toBe(true);
    expect(c.flespiControlEnabled).toBe(false);
    expect(c.tls).toBe(true);
    expect(c.flespiDeviceId).toBe('shelly1pmg4-d885acf06990');
    expect(c.password).toBeUndefined();
  });

  it('requires explicit flag', () => {
    expect(() => parseMqttConfig({ ...base(), FLESPI_MQTT_PROD_TEMP_ENABLED: 'false' }))
      .toThrow('MQTT_FLESPI_DEV_MODE_NOT_ALLOWED');
  });

  it('rejects DEV database', () => {
    expect(() => parseMqttConfig({ ...base(), DATABASE_URL:
      'postgresql://app:synthetic@smart-home-smarthomepostgresdev-vrmtpz:5432/smarthome_dev?sslmode=verify-full' }))
      .toThrow('MQTT_FLESPI_PROD_ISOLATION_INVALID');
  });

  it('rejects control without confirmed handoff', () => {
    expect(() => parseMqttConfig({ ...base(), FLESPI_MQTT_PROD_CONTROL_ENABLED: 'true' }))
      .toThrow('MQTT_FLESPI_PROD_CONTROL_HANDOFF_REQUIRED');
  });

  it('enables control only after explicit handoff acknowledgment', () => {
    const c = parseMqttConfig({ ...base(),
      FLESPI_MQTT_PROD_CONTROL_ENABLED: 'true',
      FLESPI_MQTT_PROD_HANDOFF_ACK: 'true',
    });
    expect(c.flespiControlEnabled).toBe(true);
  });

  it('rejects insecure broker', () => {
    expect(() => parseMqttConfig({ ...base(), MQTT_BROKER_URL: 'mqtt://mqtt.flespi.io:1883' }))
      .toThrow('MQTT_FLESPI_BROKER_NOT_ALLOWED');
  });

  it('rejects TLS bypass', () => {
    expect(() => parseMqttConfig({ ...base(), MQTT_TLS_REJECT_UNAUTHORIZED: 'false' }))
      .toThrow('No se permite desactivar');
  });
});