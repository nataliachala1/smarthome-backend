jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));
jest.mock('mqtt', () => ({ connect: jest.fn() }));

import { EventEmitter } from 'node:events';
import { connect, type MqttClient } from 'mqtt';
import { MqttDeviceControlPublisher } from './mqtt-device-control.publisher';
import type { MqttRuntimeService } from './mqtt-runtime.service';
import { DeviceControlPublisherUnavailableError } from '../../domain/errors/device-control.error';

const id = 'shelly1pmg4-d885acf06990';
const prefix = 'smarthome/dev/v1';
const rpcSource = `${prefix}/backend/${id}`;
const input = {
  manufacturerDeviceId: id,
  homeId: 'synthetic-home',
  deviceId: 'synthetic-device',
  action: 'TURN_ON' as const,
};

function publisher() {
  return new MqttDeviceControlPublisher({
    config: {
      flespiProduction: true,
      flespiControlEnabled: true,
      flespiDeviceId: id,
      brokerUrl: 'mqtts://mqtt.flespi.io:8883',
      rpcSource,
      switchId: 0,
    },
    topics: { control: (name: string) => `${prefix}/devices/${name}/rpc` },
    clientOptions: jest.fn().mockReturnValue({ rejectUnauthorized: true }),
  } as unknown as MqttRuntimeService);
}

describe('Flespi PROD enabled publishing', () => {
  afterEach(() => jest.clearAllMocks());

  function clientWith(publishError?: Error) {
    const client = Object.assign(new EventEmitter(), {
      connected: false,
      publish: jest.fn((_topic: string, _payload: string,
        _options: { qos: number; retain: boolean },
        callback: (error?: Error) => void) => callback(publishError)),
      end: jest.fn(),
    });
    jest.mocked(connect).mockImplementation(() => {
      process.nextTick(() => client.emit('connect'));
      return client as unknown as MqttClient;
    });
    return client;
  }

  it('publishes Switch.Set only to the exact physical Shelly with no retained command', async () => {
    const client = clientWith();
    const service = publisher();
    await expect(service.publishControlCommand(input)).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledWith('mqtts://mqtt.flespi.io:8883',
      expect.objectContaining({rejectUnauthorized: true}));
    expect(client.publish).toHaveBeenCalledTimes(1);
    const [topic, payload, options] = client.publish.mock.calls[0];
    expect(topic).toBe(`${prefix}/devices/${id}/rpc`);
    expect(options).toEqual({ qos: 1, retain: false });
    expect(JSON.parse(payload)).toMatchObject({
      src: rpcSource, method: 'Switch.Set', params: {id: 0, on: true},
    });
    service.onModuleDestroy();
  });

  it('propagates broker publish failure without pretending physical success', async () => {
    clientWith(new Error('broker unavailable'));
    const service = publisher();
    await expect(service.publishControlCommand(input))
      .rejects.toBeInstanceOf(DeviceControlPublisherUnavailableError);
    service.onModuleDestroy();
  });
});
