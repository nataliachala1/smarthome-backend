import { parseMqttConfig } from '../../../../config/mqtt-config';
import { MqttTopicContract } from './mqtt-topic-contract';

const deviceId = 'shelly1pmg4-d885acf06990';
const db = 'postgresql://dev_user:synthetic-password@smart-home-smarthomepostgresdev-vrmtpz:5432/smarthome_dev';
const env = () => ({
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
  MQTT_FLESPI_DEVICE_ID: deviceId,
});

const prefix = `smarthome/dev/v1/devices/${deviceId}`;

describe('flespi: suscripciones MQTT de telemetría por dispositivo', () => {
  it('usa solo dos tópicos exactos autorizados, sin comodines', () => {
    const contract = new MqttTopicContract(parseMqttConfig(env()));
    expect(contract.subscriptions()).toEqual([
      `${prefix}/status/switch:0`,
      `${prefix}/events/rpc`,
    ]);
    expect(contract.subscriptions().every((topic) => !/[+#]/.test(topic))).toBe(true);
  });

  it('reconoce los mensajes propios de switch y eventos RPC', () => {
    const contract = new MqttTopicContract(parseMqttConfig(env()));
    expect(contract.parseStatus(`${prefix}/status/switch:0`)).toEqual({
      manufacturerDeviceId: deviceId, kind: 'shelly-switch',
    });
    expect(contract.parseStatus(`${prefix}/events/rpc`)).toEqual({
      manufacturerDeviceId: deviceId, kind: 'shelly-events',
    });
  });

  it.each([
    'smarthome/dev/v1/devices/otro-shelly/status/switch:0',
    'smarthome/dev/v1/devices/shelly1pmg4-d885acf06991/events/rpc',
    `${prefix}/status`,
    `${prefix}/rpc`,
    `${prefix}/online`,
    `smarthome/dev/v1/backend/${deviceId}/rpc`,
    `${prefix}/status/switch:1`,
    `${prefix}/events/rpc/extra`,
    `smarthome/prod/v1/devices/${deviceId}/events/rpc`,
  ])('rechaza otros tópicos y respuestas RPC en la ingesta: %s', (topic) => {
    const contract = new MqttTopicContract(parseMqttConfig(env()));
    expect(contract.parseStatus(topic)).toBeNull();
  });

  it.each([
    undefined,
    '',
    'device-other',
    'shelly1pmg4-d885acf06990/+',
    'shelly1pmg4-d885acf06990/#',
    'shelly1pmg4-d885acf06990/status',
    'shelly1pmg4-d885acf06990 ',
  ])('rechaza un identificador flespi inválido: %p', (id) => {
    expect(() => parseMqttConfig({ ...env(), MQTT_FLESPI_DEVICE_ID: id }))
      .toThrow('MQTT_FLESPI_DEVICE_ID_INVALID');
  });

  it('rechaza namespace ajeno al alcance exacto de ACL', () => {
    expect(() => parseMqttConfig({
      ...env(), MQTT_TOPIC_NAMESPACE: 'smarthome/dev/v2',
    })).toThrow('MQTT_FLESPI_NAMESPACE_NOT_ALLOWED');
  });

  it('rechaza un ID flespi presente en la configuración Mosquitto', () => {
    expect(() => parseMqttConfig({
      ...env(), MQTT_BROKER_PROVIDER: 'mosquitto',
    })).toThrow('MQTT_FLESPI_DEVICE_ID_UNEXPECTED');
  });

  it('conserva los tres filtros históricos para Mosquitto', () => {
    const config = parseMqttConfig({
      ...env(),
      MQTT_BROKER_PROVIDER: 'mosquitto',
      MQTT_FLESPI_DEVICE_ID: undefined,
      MQTT_BROKER_URL: 'mqtts://mosquitto-dev.internal:8883',
      SHELLY_MQTT_VPS_DEV_BROKER_HOST: 'mosquitto-dev.internal',
      MQTT_USERNAME: 'synthetic-service',
      MQTT_PASSWORD: 'synthetic-password',
      MQTT_TLS_CA_FILE: '/run/secrets/mosquitto-ca.pem',
    });
    const contract = new MqttTopicContract(config);
    expect(contract.subscriptions()).toEqual([
      'smarthome/dev/v1/devices/+/status',
      'smarthome/dev/v1/devices/+/status/switch:0',
      'smarthome/dev/v1/devices/+/events/rpc',
    ]);
  });
});
