jest.mock('../../../../infrastructure/database/prisma/prisma-iot.service', () => ({
  PrismaIotService: class PrismaIotService {},
}));

jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class PrismaRlsService {},
}));

jest.mock('../../../realtime/realtime-events.service', () => ({
  RealtimeEventsService: class RealtimeEventsService {},
}));

jest.mock('./mqtt-device-status.subscriber', () => ({
  MqttDeviceStatusSubscriber: class MqttDeviceStatusSubscriber {},
}));

jest.mock('./flespi-shelly-state.reconciler', () => ({
  FlespiShellyStateReconciler: class FlespiShellyStateReconciler {},
}));
jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));
import { ConfigService } from '@nestjs/config';
import {
  createFlespiMqttRuntime,
  RoutedMqttDeviceControlPublisher,
} from './flespi-mqtt-parallel.providers';
import { MqttDeviceControlPublisher } from './mqtt-device-control.publisher';

const id = 'shelly1pmg4-d885acf06990';
const base = {
  NODE_ENV: 'production',
  APP_ENV: 'development',
  DATABASE_URL: 'postgresql://test:synthetic@smart-home-smarthomepostgresdev-vrmtpz:5432/smarthome_dev',
  DATABASE_IOT_URL: 'postgresql://test:synthetic@smart-home-smarthomepostgresdev-vrmtpz:5432/smarthome_dev',
  MQTT_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_BROKER_HOST: 'mosquitto-dev',
  MQTT_BROKER_URL: 'mqtts://mosquitto-dev:8883',
  MQTT_USERNAME: 'mosquitto-backend',
  MQTT_PASSWORD: 'synthetic-password',
  MQTT_TLS_CA_FILE: '/private/mosquitto-ca.pem',
  MQTT_TOPIC_NAMESPACE: 'smarthome/dev/v1',
  FLESPI_MQTT_DEVICE_ID: id,
  FLESPI_MQTT_BACKEND_TOKEN: 'synthetic-flespi-acl-token',
};

const config = (data: Record<string, unknown> = base): ConfigService => ({
  get: (name: string): unknown => data[name],
} as ConfigService);

describe('parallel DEV flespi runtime', () => {
  it('uses a separate TLS token, precise device topics, and no Mosquitto secrets', () => {
    const runtime = createFlespiMqttRuntime(config());
    expect(runtime.config.brokerUrl).toBe('mqtts://mqtt.flespi.io:8883');
    expect(runtime.config.username).toBe(base.FLESPI_MQTT_BACKEND_TOKEN);
    expect(runtime.config.password).toBeUndefined();
    expect(runtime.config.caFile).toBeUndefined();
    expect(runtime.config.flespiDeviceId).toBe(id);
    expect(runtime.config.tls).toBe(true);
    expect(runtime.topics.subscriptions()).toEqual([
      `smarthome/dev/v1/devices/${id}/status/switch:0`,
      `smarthome/dev/v1/devices/${id}/events/rpc`,
    ]);
  });

  it('fails closed for a missing token or device ID', () => {
    const noToken: Record<string, unknown> = { ...base };
    delete noToken.FLESPI_MQTT_BACKEND_TOKEN;
    expect(() => createFlespiMqttRuntime(config(noToken))).toThrow('MQTT_FLESPI_TOKEN_AUTH_REQUIRED');
    const noDevice: Record<string, unknown> = { ...base };
    delete noDevice.FLESPI_MQTT_DEVICE_ID;
    expect(() => createFlespiMqttRuntime(config(noDevice))).toThrow('MQTT_FLESPI_DEVICE_ID_INVALID');
  });

  it('routes only the designated Shelly through flespi', async () => {
    const mosquitto = { publishControlCommand: jest.fn().mockResolvedValue(undefined) };
    const flespi = { publishControlCommand: jest.fn().mockResolvedValue(undefined) };
    const router = new RoutedMqttDeviceControlPublisher(
      mosquitto as unknown as MqttDeviceControlPublisher,
      flespi as unknown as MqttDeviceControlPublisher,
      id,
    );
    const input = {
      manufacturerDeviceId: id,
      action: 'TURN_ON',
      homeId: 'home',
      deviceId: 'device',
    } as Parameters<typeof router.publishControlCommand>[0];
    await router.publishControlCommand(input);
    expect(flespi.publishControlCommand).toHaveBeenCalledTimes(1);
    expect(mosquitto.publishControlCommand).not.toHaveBeenCalled();
    await router.publishControlCommand({ ...input, manufacturerDeviceId: 'another-device' });
    expect(mosquitto.publishControlCommand).toHaveBeenCalledTimes(1);
  });
});
