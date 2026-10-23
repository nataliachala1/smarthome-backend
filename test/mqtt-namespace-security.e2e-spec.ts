import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { connect, MqttClient } from 'mqtt';
import { MqttRuntimeService } from '../src/modules/devices/infrastructure/messaging/mqtt-runtime.service';
import { MqttDeviceControlPublisher } from '../src/modules/devices/infrastructure/messaging/mqtt-device-control.publisher';
import { MqttDeviceStatusSubscriber } from '../src/modules/devices/infrastructure/messaging/mqtt-device-status.subscriber';
import { PrismaIotService } from '../src/infrastructure/database/prisma/prisma-iot.service';
import { PrismaRlsService } from '../src/infrastructure/database/prisma/prisma-rls.service';
import { RealtimeEventsService } from '../src/modules/realtime/realtime-events.service';
import {
  DeviceControlNotConfiguredError,
  DeviceControlPublisherUnavailableError,
} from '../src/modules/devices/domain/errors/device-control.error';
import { ProvisionShellyDeviceUseCase } from '../src/modules/devices/application/use-cases/provision-shelly-device.use-case';
import { IdentifyShellyDeviceUseCase } from '../src/modules/devices/application/use-cases/identify-shelly-device.use-case';
import { CreateDeviceUseCase } from '../src/modules/devices/application/use-cases/create-device.use-case';
import { ShellyRpcClientService } from '../src/modules/devices/infrastructure/shelly/shelly-rpc-client.service';

jest.mock('mqtt', () => ({ connect: jest.fn() }));
jest.mock('../src/infrastructure/database/prisma/prisma-iot.service', () => ({
  PrismaIotService: class {},
}));
jest.mock('../src/infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class {},
}));
jest.mock('../src/modules/realtime/realtime-events.service', () => ({
  RealtimeEventsService: class {},
}));
jest.mock('../generated/prisma/client', () => ({ Prisma: {} }));

const cloud = {
  NODE_ENV: 'production',
  MQTT_BROKER_URL: 'mqtts://broker.example.test:8883',
  MQTT_TOPIC_NAMESPACE: 'smarthome/staging/v1',
  MQTT_USERNAME: 'synthetic-service',
  MQTT_PASSWORD: 'synthetic-password',
};
const command = {
  homeId: 'home-fixture',
  deviceId: 'device-fixture',
  manufacturerDeviceId: 'shelly-test',
  action: 'TURN_ON' as const,
};

function config(settings: Record<string, unknown>): ConfigService {
  // Deliberately isolated from process.env and all .env files.
  return { get: (key: string) => settings[key] } as unknown as ConfigService;
}

class FakeClient extends EventEmitter {
  connected = false;
  publish = jest.fn(
    (
      _topic: string,
      _payload: string,
      _options: unknown,
      callback: (error?: Error) => void,
    ) => callback(),
  );
  subscribe = jest.fn(
    (_topics: string[], _options: unknown, callback: (error?: Error) => void) =>
      callback(),
  );
  end = jest.fn();
  connectNow() {
    this.connected = true;
    this.emit('connect');
  }
}

describe('HU10 MQTT adapter integration (synthetic transport, no broker/DB/Shelly)', () => {
  let client: FakeClient;
  let runtime: MqttRuntimeService;
  let publisher: MqttDeviceControlPublisher;
  let subscriber: MqttDeviceStatusSubscriber | undefined;
  let logError: jest.SpyInstance;
  const connectMock = jest.mocked(connect);
  const findFirst = jest.fn().mockResolvedValue(null);
  let caDirectory: string;
  let caFile: string;

  beforeAll(() => {
    fs.mkdirSync('.tmp', { recursive: true });
    caDirectory = fs.mkdtempSync(join('.tmp', 'mqtt-ca-'));
    caFile = join(caDirectory, 'synthetic-ca.pem');
  });
  afterAll(() => {
    if (fs.existsSync(caFile)) fs.unlinkSync(caFile);
    fs.rmdirSync(caDirectory);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    client = new FakeClient();
    connectMock.mockReset().mockReturnValue(client as unknown as MqttClient);
    runtime = new MqttRuntimeService(config(cloud));
    publisher = new MqttDeviceControlPublisher(runtime);
    subscriber = undefined;
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    publisher.onModuleDestroy();
    subscriber?.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function startSubscriber(settings = cloud) {
    runtime = new MqttRuntimeService(config(settings));
    subscriber = new MqttDeviceStatusSubscriber(
      runtime,
      { device: { findFirst } } as unknown as PrismaIotService,
      {} as PrismaRlsService,
      {} as RealtimeEventsService,
    );
    subscriber.onModuleInit();
    client.connectNow();
  }

  const receive = async (topic: string, payload: unknown) => {
    client.emit(
      'message',
      topic,
      Buffer.from(
        typeof payload === 'string' ? payload : JSON.stringify(payload),
      ),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  it('passes verified TLS and service authentication to both MQTT adapters', async () => {
    startSubscriber();
    const pending = publisher.publishControlCommand(command);
    client.connectNow();
    await pending;
    expect(connectMock).toHaveBeenCalledTimes(2);
    for (const [url, options] of connectMock.mock.calls) {
      expect(url).toBe(cloud.MQTT_BROKER_URL);
      expect(options).toMatchObject({
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        username: cloud.MQTT_USERNAME,
        password: cloud.MQTT_PASSWORD,
      });
      expect(options).not.toHaveProperty('checkServerIdentity');
    }
    expect(connectMock.mock.calls[0][1]?.clientId).not.toBe(
      connectMock.mock.calls[1][1]?.clientId,
    );
  });

  it('publishes Shelly RPC on the configured prefix with QoS 1 and no retain', async () => {
    const pending = publisher.publishControlCommand(command);
    client.connectNow();
    await pending;
    const [topic, payload, options] = client.publish.mock.calls[0];
    expect(topic).toBe('smarthome/staging/v1/devices/shelly-test/rpc');
    expect(JSON.parse(payload)).toMatchObject({
      src: 'smarthome/staging/v1/backend/devices/shelly-test',
      method: 'Switch.Set',
      params: { id: 0, on: true },
    });
    expect(options).toEqual({ qos: 1, retain: false });
  });

  it('publishes the internal device contract in the same namespace', async () => {
    const pending = publisher.publishControlCommand({
      ...command,
      manufacturerDeviceId: 'Lamp-1',
    });
    client.connectNow();
    await pending;
    expect(client.publish.mock.calls[0][0]).toBe(
      'smarthome/staging/v1/devices/Lamp-1/control',
    );
    expect(JSON.parse(client.publish.mock.calls[0][1])).toMatchObject({
      command: 'TURN_ON',
      manufacturerDeviceId: 'Lamp-1',
    });
  });

  it('shares one pending connection across concurrent commands', async () => {
    const first = publisher.publishControlCommand(command);
    const second = publisher.publishControlCommand(command);
    client.connectNow();
    await Promise.all([first, second]);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(client.publish).toHaveBeenCalledTimes(2);
  });

  it('waits on the existing client during reconnection', async () => {
    const initial = publisher.publishControlCommand(command);
    client.connectNow();
    await initial;
    client.connected = false;
    const pending = publisher.publishControlCommand(command);
    client.connectNow();
    await pending;
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid identifiers before opening any connection', async () => {
    await expect(
      publisher.publishControlCommand({
        ...command,
        manufacturerDeviceId: 'shelly/+/other',
      }),
    ).rejects.toBeInstanceOf(DeviceControlNotConfiguredError);
    expect(connectMock).not.toHaveBeenCalled();
    expect(client.publish).not.toHaveBeenCalled();
  });

  it('maps TLS errors without publishing and permits a subsequent retry', async () => {
    const pending = publisher.publishControlCommand(command);
    const assertion = expect(pending).rejects.toBeInstanceOf(
      DeviceControlPublisherUnavailableError,
    );
    client.emit('error', new Error('synthetic-password certificate failure'));
    await assertion;
    expect(client.publish).not.toHaveBeenCalled();
    expect(client.end).toHaveBeenCalledWith(true);
    const retry = publisher.publishControlCommand(command);
    client.connectNow();
    await retry;
    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('expires connection attempts and cleans up the waiting client', async () => {
    jest.useFakeTimers();
    const pending = publisher.publishControlCommand(command);
    const assertion = expect(pending).rejects.toBeInstanceOf(
      DeviceControlPublisherUnavailableError,
    );
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(client.end).toHaveBeenCalledWith(true);
    expect(client.publish).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('subscribes to exact status routes again after reconnect', () => {
    startSubscriber();
    client.connectNow();
    expect(client.subscribe).toHaveBeenCalledTimes(2);
    expect(client.subscribe.mock.calls[0].slice(0, 2)).toEqual([
      [
        'smarthome/staging/v1/devices/+/status',
        'smarthome/staging/v1/devices/+/status/switch:0',
        'smarthome/staging/v1/devices/+/events/rpc',
      ],
      { qos: 1 },
    ]);
  });

  it.each([
    'smarthome/production/v1/devices/shelly-test/status/switch:0',
    'shelly-test/status/switch:0',
    'smarthome/devices/Lamp-1/status',
    'smarthome/staging/v1/devices/shelly-test/status/switch:1',
    'smarthome/staging/v1/devices/+/status',
  ])(
    'drops foreign or invalid topics before database access: %s',
    async (topic) => {
      startSubscriber();
      await receive(topic, { isOn: true, output: true, apower: 20 });
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'smarthome/staging/v1/devices/Lamp-1/status',
      { isOn: true, currentPowerW: 20 },
      'Lamp-1',
    ],
    [
      'smarthome/staging/v1/devices/shelly-test/status/switch:0',
      { output: true, apower: 20 },
      'shelly-test',
    ],
    [
      'smarthome/staging/v1/devices/shelly-test/events/rpc',
      {
        method: 'NotifyStatus',
        params: { 'switch:0': { output: true, apower: 20 } },
      },
      'shelly-test',
    ],
  ])(
    'resolves valid status messages to the original manufacturer ID',
    async (topic, payload, id) => {
      startSubscriber();
      await receive(topic, payload);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            manufacturer_device_id: id,
            status: 'ACTIVE',
            deleted_at: null,
          },
        }),
      );
    },
  );

  it.each([
    [
      'smarthome/staging/v1/devices/shelly-test/events/rpc',
      { method: 'Switch.Set', params: { 'switch:0': { output: true } } },
    ],
    [
      'smarthome/staging/v1/devices/shelly-test/status/switch:0',
      { isOn: true },
    ],
    ['smarthome/staging/v1/devices/Lamp-1/status', { output: true }],
    ['smarthome/staging/v1/devices/Lamp-1/status', '{not-json'],
  ])(
    'rejects malformed payloads and messages on the wrong protocol route',
    async (topic, payload) => {
      startSubscriber();
      await receive(topic, payload);
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it('redacts transport and processing errors', async () => {
    startSubscriber();
    client.emit('error', new Error('synthetic-password transport details'));
    findFirst.mockRejectedValueOnce(
      new Error('synthetic-password query details'),
    );
    await receive('smarthome/staging/v1/devices/Lamp-1/status', { isOn: true });
    expect(logError).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      'synthetic-password',
    );
  });

  it('preserves legacy local publisher and subscriber contracts', async () => {
    const local = { MQTT_BROKER_URL: 'mqtt://localhost:1883' };
    runtime = new MqttRuntimeService(config(local));
    publisher = new MqttDeviceControlPublisher(runtime);
    subscriber = new MqttDeviceStatusSubscriber(
      runtime,
      { device: { findFirst } } as unknown as PrismaIotService,
      {} as PrismaRlsService,
      {} as RealtimeEventsService,
    );
    subscriber.onModuleInit();
    const pending = publisher.publishControlCommand(command);
    client.connectNow();
    await pending;
    expect(client.publish.mock.calls[0][0]).toBe('shelly-test/rpc');
    await receive('shelly-test/status/switch:0', { output: true });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it.each([
    cloud,
    { MQTT_BROKER_URL: 'mqtts://broker.example.test' },
    { MQTT_TOPIC_NAMESPACE: 'smarthome/test/v1' },
  ])(
    'blocks legacy provisioning before exposing service credentials or making LAN requests',
    async (settings) => {
      const identify = { execute: jest.fn() };
      const rpc = { configureMqtt: jest.fn(), reboot: jest.fn() };
      const create = { execute: jest.fn() };
      const useCase = new ProvisionShellyDeviceUseCase(
        new MqttRuntimeService(config(settings)),
        config(settings),
        identify as unknown as IdentifyShellyDeviceUseCase,
        rpc as unknown as ShellyRpcClientService,
        create as unknown as CreateDeviceUseCase,
      );
      try {
        await useCase.execute({
          userId: 'user',
          homeId: 'home',
          shellyIp: '192.168.50.10',
          name: 'fixture',
        });
        throw new Error('Expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(
          (error as ServiceUnavailableException).getResponse(),
        ).toMatchObject({ code: 'MQTT_DEVICE_BOOTSTRAP_REQUIRED' });
      }
      expect(identify.execute).not.toHaveBeenCalled();
      expect(rpc.configureMqtt).not.toHaveBeenCalled();
      expect(rpc.reboot).not.toHaveBeenCalled();
      expect(create.execute).not.toHaveBeenCalled();
    },
  );

  it('uses a supplied public CA bundle without disabling hostname verification', () => {
    fs.writeFileSync(caFile, rootCertificates[0]);
    const custom = new MqttRuntimeService(
      config({ ...cloud, MQTT_TLS_CA_FILE: caFile }),
    );
    expect(custom.clientOptions('control').ca).toEqual(
      Buffer.from(rootCertificates[0]),
    );
    expect(custom.clientOptions('status').rejectUnauthorized).toBe(true);
    expect(custom.clientOptions('status')).not.toHaveProperty(
      'checkServerIdentity',
    );
  });

  it.each([
    '',
    'not-a-certificate',
    '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----',
  ])('rejects malformed CA material before connecting', (pem) => {
    fs.writeFileSync(caFile, pem);
    expect(
      () =>
        new MqttRuntimeService(config({ ...cloud, MQTT_TLS_CA_FILE: caFile })),
    ).toThrow('MQTT_TLS_CA_FILE');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('does not expose the CA file path or filesystem error', () => {
    expect(
      () =>
        new MqttRuntimeService(
          config({
            ...cloud,
            MQTT_TLS_CA_FILE: join(caDirectory, 'private-path-information'),
          }),
        ),
    ).toThrow(
      new Error(
        'MQTT_TLS_CA_FILE no contiene certificados PEM legibles y válidos.',
      ),
    );
  });
});
