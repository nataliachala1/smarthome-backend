import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import Bonjour from 'bonjour-service';
import { PrismaRlsService } from '../src/infrastructure/database/prisma/prisma-rls.service';
import { JwtAuthGuard } from '../src/modules/auth/presentation/http/guards/jwt-auth.guard';
import { CreateDeviceUseCase } from '../src/modules/devices/application/use-cases/create-device.use-case';
import { DiscoverShellyDevicesUseCase } from '../src/modules/devices/application/use-cases/discover-shelly-devices.use-case';
import { IdentifyShellyDeviceUseCase } from '../src/modules/devices/application/use-cases/identify-shelly-device.use-case';
import { ProvisionShellyDeviceUseCase } from '../src/modules/devices/application/use-cases/provision-shelly-device.use-case';
import { DeviceRepository } from '../src/modules/devices/domain/repositories/device.repository';
import { ShellyDiscoveryService } from '../src/modules/devices/infrastructure/shelly/shelly-discovery.service';
import {
  ShellyLocalAccessService,
  ShellyLocalGuard,
} from '../src/modules/devices/infrastructure/shelly/shelly-local-access.service';
import { ShellyRpcClientService } from '../src/modules/devices/infrastructure/shelly/shelly-rpc-client.service';
import { ShellyController } from '../src/modules/devices/presentation/controllers/shelly.controller';

jest.mock('../src/infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class PrismaRlsService {},
}));
jest.mock('bonjour-service', () =>
  jest.fn(() => {
    throw new Error('Real mDNS is forbidden in this synthetic suite');
  }),
);

const ip = '192.168.50.10';
const homeId = '20000000-0000-4000-8000-000000000001';
const deviceInfo = {
  id: 'shelly-synthetic',
  mac: '000000000001',
  model: 'S4SW-001P16EU',
  gen: 4,
  auth_en: false,
  ver: 'test',
};
const mqttConfig = {
  server: 'broker.example.test:1883',
  topicPrefix: 'shelly-synthetic',
  username: 'synthetic-user',
  password: 'synthetic-password',
};
const path = `/api/v1/homes/${homeId}/shelly`;

describe('HU13 local Shelly RPC and HTTP contracts (synthetic transport)', () => {
  let app: INestApplication;
  let rpc: ShellyRpcClientService;
  let discovery: ShellyDiscoveryService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let settings: Record<string, unknown>;
  let allowed = true;
  const createDevice = jest.fn();
  const withUserContext = jest.fn(
    async (
      _userId: string,
      operation: (tx: {
        $queryRaw: () => Promise<{ allowed: boolean }[]>;
      }) => Promise<unknown>,
    ) => operation({ $queryRaw: () => Promise.resolve([{ allowed }]) }),
  );

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ShellyController],
      providers: [
        ShellyLocalAccessService,
        ShellyLocalGuard,
        ShellyRpcClientService,
        ShellyDiscoveryService,
        CreateDeviceUseCase,
        DiscoverShellyDevicesUseCase,
        IdentifyShellyDeviceUseCase,
        ProvisionShellyDeviceUseCase,
        {
          provide: ConfigService,
          useValue: { get: (name: string) => settings[name] },
        },
        { provide: PrismaRlsService, useValue: { withUserContext } },
        { provide: DeviceRepository, useValue: { create: createDevice } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context
            .switchToHttp()
            .getRequest<{ user: { userId: string; role: string } }>().user = {
            userId: '10000000-0000-4000-8000-000000000001',
            role: 'USER',
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    rpc = module.get(ShellyRpcClientService);
    discovery = module.get(ShellyDiscoveryService);
  });

  beforeEach(() => {
    settings = {
      NODE_ENV: 'test',
      SHELLY_LOCAL_ENABLED: 'true',
      MQTT_DEVICE_BROKER_SERVER: mqttConfig.server,
      MQTT_USERNAME: mqttConfig.username,
      MQTT_PASSWORD: mqttConfig.password,
    };
    allowed = true;
    createDevice.mockReset();
    withUserContext.mockClear();
    jest.mocked(Bonjour).mockClear();
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected synthetic fetch'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  afterAll(async () => {
    await app?.close();
  });

  function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  function provision() {
    return request(app.getHttpServer() as Server)
      .post(`${path}/provision`)
      .send({ shellyIp: ip, name: 'Synthetic switch' });
  }

  it.each([undefined, 'false', 'invalid'])(
    'blocks every local endpoint before database or network access with flag %p',
    async (flag) => {
      settings.SHELLY_LOCAL_ENABLED = flag;
      for (const call of [
        () => request(app.getHttpServer() as Server).get(`${path}/discover`),
        () =>
          request(app.getHttpServer() as Server)
            .post(`${path}/identify`)
            .send({ shellyIp: ip }),
        () => provision(),
      ]) {
        const result = await call().expect(403);
        expect(result.body).toMatchObject({ code: 'SHELLY_LOCAL_DISABLED' });
      }
      expect(withUserContext).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(Bonjour).not.toHaveBeenCalled();
      expect(createDevice).not.toHaveBeenCalled();
    },
  );

  it('blocks direct RPC and mDNS calls in production even with a true flag', async () => {
    settings.NODE_ENV = 'production';
    for (const call of [
      () => rpc.getDeviceInfo(ip),
      () => rpc.getMqttStatus(ip),
      () => rpc.configureMqtt(ip, mqttConfig),
      () => rpc.reboot(ip),
      () => rpc.waitForMqttConnection(ip),
      () => discovery.discover(),
    ])
      await expect(call()).rejects.toMatchObject({
        response: { code: 'SHELLY_LOCAL_DISABLED' },
      });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Bonjour).not.toHaveBeenCalled();
  });

  it('preserves household permission checks before external effects when local mode is enabled', async () => {
    allowed = false;
    await request(app.getHttpServer() as Server)
      .get(`${path}/discover`)
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post(`${path}/identify`)
      .send({ shellyIp: ip })
      .expect(403);
    await provision().expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Bonjour).not.toHaveBeenCalled();
    expect(createDevice).not.toHaveBeenCalled();
  });

  it('allows the enabled discovery endpoint to use its diagnostic service', async () => {
    const discover = jest.spyOn(discovery, 'discover').mockResolvedValue([]);
    await request(app.getHttpServer() as Server)
      .get(`${path}/discover`)
      .expect(200, []);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it.each([
    '127.0.0.1',
    'localhost',
    '8.8.8.8',
    '169.254.169.254',
    '172.15.1.1',
    '172.32.1.1',
    '::1',
    '192.168.1.1/path',
  ])(
    'rejects non-private or malformed target %s without fetch',
    async (target) => {
      await expect(rpc.configureMqtt(target, mqttConfig)).rejects.toMatchObject(
        { response: { code: 'SHELLY_INVALID_IP' } },
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1'])(
    'retains supported private IPv4 range %s',
    async (target) => {
      fetchMock.mockResolvedValue(response(deviceInfo));
      await expect(rpc.getDeviceInfo(target)).resolves.toEqual(deviceInfo);
    },
  );

  it.each([true, false])(
    'accepts a boolean restart_required=%s with the existing direct HTTP request format',
    async (restart) => {
      fetchMock.mockResolvedValue(
        response({ restart_required: restart, future_field: 'allowed' }),
      );
      await expect(rpc.configureMqtt(ip, mqttConfig)).resolves.toEqual({
        restartRequired: restart,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `http://${ip}/rpc/MQTT.SetConfig`,
        expect.objectContaining({
          method: 'POST',
          redirect: 'error',
          body: JSON.stringify({
            config: {
              enable: true,
              server: mqttConfig.server,
              ssl_ca: 'ca.pem',
              topic_prefix: mqttConfig.topicPrefix,
              rpc_ntf: true,
              status_ntf: true,
              enable_rpc: true,
              enable_control: true,
              user: mqttConfig.username,
              pass: mqttConfig.password,
            },
          }),
        }),
      );
      expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    },
  );

  it.each([
    'null',
    '',
    ' ',
    '{invalid',
    '[]',
    'true',
    '"text"',
    '{}',
    '{"restart_required":"true"}',
    '{"restart_required":0}',
    '{"result":{"restart_required":true}}',
  ])('rejects invalid SetConfig response %p', async (body) => {
    fetchMock.mockResolvedValue(new Response(body));
    await expect(rpc.configureMqtt(ip, mqttConfig)).rejects.toMatchObject({
      response: { code: 'SHELLY_INVALID_RESPONSE' },
    });
  });

  it.each([401, 403, 404, 500, 503])(
    'returns a sanitized diagnostic for upstream HTTP %s',
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response('upstream-body-containing-synthetic-password', { status }),
      );
      await expect(rpc.configureMqtt(ip, mqttConfig)).rejects.toMatchObject({
        response: {
          code: [401, 403].includes(status)
            ? 'SHELLY_AUTH_REQUIRED'
            : 'SHELLY_HTTP_ERROR',
        },
      });
    },
  );

  it.each([
    { error: { code: 500, message: 'synthetic-password' } },
    { code: 500, message: 'synthetic-password' },
  ])(
    'rejects a successful HTTP response carrying an RPC error',
    async (body) => {
      fetchMock.mockResolvedValue(response(body));
      await expect(rpc.configureMqtt(ip, mqttConfig)).rejects.toMatchObject({
        response: {
          code: 'SHELLY_RPC_ERROR',
          message: 'El Shelly rechazó la operación RPC.',
        },
      });
    },
  );

  it('sanitizes transport errors and cleans its timer', async () => {
    jest.useFakeTimers();
    fetchMock.mockRejectedValue(
      new Error('synthetic-password at private address'),
    );
    await expect(rpc.configureMqtt(ip, mqttConfig)).rejects.toMatchObject({
      response: {
        code: 'SHELLY_UNREACHABLE',
        message: 'No fue posible contactar al Shelly.',
      },
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts a pending fetch at three seconds and clears its timeout', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    fetchMock.mockImplementation((_url, init) => {
      signal = init?.signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    });
    const pending = expect(
      rpc.configureMqtt(ip, mqttConfig),
    ).rejects.toMatchObject({ response: { code: 'SHELLY_RPC_TIMEOUT' } });
    await jest.advanceTimersByTimeAsync(3000);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the timeout active while reading a stalled response body', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener('abort', () =>
                controller.error(new Error('body aborted')),
              );
            },
          }),
        ),
      ),
    );
    const pending = expect(
      rpc.configureMqtt(ip, mqttConfig),
    ).rejects.toMatchObject({ response: { code: 'SHELLY_RPC_TIMEOUT' } });
    await jest.advanceTimersByTimeAsync(3000);
    await pending;
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['null', '', '   '])(
    'accepts null or legacy empty reboot responses only for reboot (%p)',
    async (body) => {
      fetchMock.mockResolvedValue(new Response(body));
      await expect(rpc.reboot(ip)).resolves.toBeUndefined();
    },
  );

  it.each(['{}', 'false', '{broken'])(
    'rejects other reboot responses %p',
    async (body) => {
      fetchMock.mockResolvedValue(new Response(body));
      await expect(rpc.reboot(ip)).rejects.toMatchObject({
        response: { code: 'SHELLY_INVALID_RESPONSE' },
      });
    },
  );

  it.each([
    { auth_en: undefined },
    { auth_en: 'false' },
    { gen: 4.5 },
    { gen: '4' },
    { ver: {} },
    { id: ' ' },
  ])('rejects malformed identity fields %p', async (fields) => {
    fetchMock.mockResolvedValue(response({ ...deviceInfo, ...fields }));
    await expect(rpc.getDeviceInfo(ip)).rejects.toMatchObject({
      response: { code: 'SHELLY_INVALID_DEVICE' },
    });
  });

  it.each([true, false])(
    'distinguishes a valid connected=%s status from a probe failure',
    async (connected) => {
      fetchMock.mockResolvedValue(response({ connected }));
      await expect(rpc.getMqttStatus(ip)).resolves.toEqual({
        connected,
        errorCode: null,
      });
    },
  );

  it('keeps identification useful while exposing a sanitized MQTT probe failure', async () => {
    fetchMock
      .mockResolvedValueOnce(response(deviceInfo))
      .mockResolvedValueOnce(
        new Response('synthetic-password', { status: 401 }),
      );
    const result = await request(app.getHttpServer() as Server)
      .post(`${path}/identify`)
      .send({ shellyIp: ip })
      .expect(201);
    expect(result.body).toMatchObject({
      manufacturerDeviceId: deviceInfo.id,
      mqttConnected: null,
      mqttStatusErrorCode: 'SHELLY_AUTH_REQUIRED',
    });
    expect(result.text).not.toContain('synthetic-password');
  });

  it('does not probe or configure an authenticated device during provisioning', async () => {
    fetchMock.mockResolvedValue(response({ ...deviceInfo, auth_en: true }));
    const result = await provision().expect(422);
    expect(result.body).toMatchObject({ code: 'SHELLY_AUTH_REQUIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createDevice).not.toHaveBeenCalled();
  });

  it('stops provisioning before reboot and persistence when SetConfig is invalid', async () => {
    fetchMock
      .mockResolvedValueOnce(response(deviceInfo))
      .mockResolvedValueOnce(response({ connected: false }))
      .mockResolvedValueOnce(response(null));
    const result = await provision().expect(502);
    expect(result.body).toMatchObject({ code: 'SHELLY_INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(createDevice).not.toHaveBeenCalled();
  });

  it('recovers from a transient MQTT status failure within the retry budget', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new Error('booting'))
      .mockResolvedValueOnce(response({ connected: true }));
    const pending = rpc.waitForMqttConnection(ip, 2, 1500);
    await jest.advanceTimersByTimeAsync(3500);
    await expect(pending).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves the last diagnostic when every MQTT status attempt fails', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(() =>
      Promise.resolve(response({ connected: 'false' })),
    );
    const pending = expect(
      rpc.waitForMqttConnection(ip, 2, 1500),
    ).rejects.toMatchObject({ response: { code: 'SHELLY_INVALID_RESPONSE' } });
    await jest.advanceTimersByTimeAsync(3500);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a valid disconnected status separately after the retry budget', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(() =>
      Promise.resolve(response({ connected: false })),
    );
    const pending = rpc.waitForMqttConnection(ip, 2, 1500);
    await jest.advanceTimersByTimeAsync(3500);
    await expect(pending).resolves.toBe(false);
  });

  it('preserves successful provisioning and waits for a connected result before persistence', async () => {
    const wait = jest
      .spyOn(rpc, 'waitForMqttConnection')
      .mockResolvedValue(true);
    fetchMock
      .mockResolvedValueOnce(response(deviceInfo))
      .mockResolvedValueOnce(response({ connected: false }))
      .mockResolvedValueOnce(response({ restart_required: true }))
      .mockResolvedValueOnce(response(null));
    createDevice.mockResolvedValue({
      id: '40000000-0000-4000-8000-000000000001',
      homeId,
      name: 'Synthetic switch',
    });
    const result = await provision().expect(201);
    expect(result.body).toMatchObject({ mqtt: { connected: true } });
    expect(fetchMock.mock.calls[3][0]).toBe(`http://${ip}/rpc/Shelly.Reboot`);
    expect(wait).toHaveBeenCalledWith(ip);
    expect(wait.mock.invocationCallOrder[0]).toBeLessThan(
      createDevice.mock.invocationCallOrder[0],
    );
    expect(createDevice).toHaveBeenCalledTimes(1);
    expect(result.text).not.toContain(mqttConfig.password);
  });
});
