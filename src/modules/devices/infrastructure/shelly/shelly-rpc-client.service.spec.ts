jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { ShellyLocalAccessService } from './shelly-local-access.service';
import { ShellyRpcClientService } from './shelly-rpc-client.service';

const IP = '192.168.50.10';
const info = {
  id: 'shelly-synthetic', mac: '000000000001', model: 'S4SW-001P16EU',
  gen: 4, auth_en: false, ver: 'test',
};

describe('ShellyRpcClientService local RPC safety', () => {
  let localAccess: { assertEnabled: jest.Mock<void, []> };
  let rpc: ShellyRpcClientService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    localAccess = { assertEnabled: jest.fn<void, []>() };
    rpc = new ShellyRpcClientService(localAccess as unknown as ShellyLocalAccessService);
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(['127.0.0.1', 'localhost', '8.8.8.8', '169.254.169.254', '172.32.1.1', '::1'])(
    'rejects non-private or non-IPv4 target %s before fetch',
    async (target) => {
      await expect(rpc.getDeviceInfo(target)).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...info, auth_en: undefined },
    { ...info, auth_en: 'false' },
    { ...info, gen: 4.5 },
    { ...info, gen: '4' },
    { ...info, id: ' ' },
  ])('rejects malformed Shelly identity data %p', async (body) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(rpc.getDeviceInfo(IP)).rejects.toThrow(UnprocessableEntityException);
  });

  it('returns device info only with validated auth flag and positive integer generation', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(info)));
    await expect(rpc.getDeviceInfo(IP)).resolves.toEqual(info);
    expect(localAccess.assertEnabled).toHaveBeenCalledTimes(1);
  });

  it('pins the Shelly built-in CA validation setting when constructing MQTT RPC', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ restart_required: true })));
    await expect(rpc.configureMqtt(IP, {
      server: 'mqtts://mqtt-dev.example.test:443', topicPrefix: 'device-synthetic',
    })).resolves.toEqual({ restartRequired: true });
    const init = fetchMock.mock.calls[0][1];
    const body = init?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') throw new Error('RPC_BODY_INVALID');
    expect(JSON.parse(body)).toMatchObject({
      config: { server: 'mqtts://mqtt-dev.example.test:443', ssl_ca: 'ca.pem' },
    });
  });

  it('does not disclose upstream response content on HTTP errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('synthetic-password', { status: 503 }));
    await expect(rpc.getDeviceInfo(IP)).rejects.toMatchObject({
      response: { code: 'SHELLY_HTTP_ERROR' },
    });
  });

  it('keeps invalid MQTT status separate from a valid disconnected result', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ connected: false })));
    await expect(rpc.getMqttStatus(IP)).resolves.toEqual({ connected: false, errorCode: null });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ connected: 'false' })));
    await expect(rpc.getMqttStatus(IP)).resolves.toEqual({
      connected: null, errorCode: 'SHELLY_INVALID_RESPONSE',
    });
  });
});
