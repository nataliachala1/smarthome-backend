jest.mock('./mqtt-runtime.service', () => ({ MqttRuntimeService: class {} }));
import { EventEmitter } from 'node:events';
import { connect } from 'mqtt';
import { FlespiShellyStatusRpcClient } from './flespi-shelly-status-rpc.client';

jest.mock('mqtt', () => ({ connect: jest.fn() }));

const ID = 'shelly1pmg4-d885acf06990';
const source = `smarthome/dev/v1/backend/${ID}`;
const responseTopic = `${source}/rpc`;
const requestTopic = `smarthome/dev/v1/devices/${ID}/rpc`;

function setup(options: { denied?: boolean; responder?: (request: Record<string, unknown>) => Record<string, unknown>[] } = {}) {
  const client = new EventEmitter() as EventEmitter & {
    subscribe: jest.Mock;
    publish: jest.Mock;
    end: jest.Mock;
  };
  client.end = jest.fn();
  client.subscribe = jest.fn((_topic: string, _opt: unknown, callback: Function) =>
    callback(null, [{ topic: responseTopic, qos: options.denied ? 128 : 1 }]));
  client.publish = jest.fn((_topic: string, payload: string, _opt: unknown, callback: Function) => {
    const request = JSON.parse(payload) as Record<string, unknown>;
    callback(null);
    const replies = options.responder?.(request) ?? [{
      id: request.id, src: ID, dst: source,
      result: { id: 0, output: true, apower: 98.5, voltage: 116.9, current: 0.842 },
    }];
    process.nextTick(() => {
      for (const reply of replies)
        client.emit('message', responseTopic, Buffer.from(JSON.stringify(reply)), { retain: false });
    });
  });
  (connect as jest.Mock).mockReturnValue(client);
  const runtime = {
    config: {
      flespiDeviceId: ID, namespace: 'smarthome/dev/v1',
      brokerUrl: 'mqtts://mqtt.flespi.io:8883', tls: true,
      rpcSource: source, switchId: 0,
    },
    topics: { control: jest.fn().mockReturnValue(requestTopic) },
    clientOptions: jest.fn().mockReturnValue({ username: 'synthetic-test-token', clientId: 'shared-status-id' }),
  };
  const rpc = new FlespiShellyStatusRpcClient(runtime as never);
  return { rpc, runtime, client };
}

describe('3D.6-A flespi Switch.GetStatus readonly adapter', () => {
  afterEach(() => jest.resetAllMocks());

  it('subscribes before sending only Switch.GetStatus and validates the returned data', async () => {
    const { rpc, client } = setup();
    const pending = rpc.getSwitchStatus();
    client.emit('connect');
    const result = await pending;
    expect(result).toEqual(expect.objectContaining({
      output: true, powerW: 98.5, voltageV: 116.9, currentA: 0.842,
      receivedAt: expect.any(Date),
    }));
    const request = JSON.parse(client.publish.mock.calls[0][1] as string);
    expect(request).toMatchObject({ method: 'Switch.GetStatus', src: source, params: { id: 0 } });
    expect(client.subscribe).toHaveBeenCalledWith(responseTopic, { qos: 1 }, expect.any(Function));
    expect(client.subscribe.mock.invocationCallOrder[0]).toBeLessThan(client.publish.mock.invocationCallOrder[0]);
    expect(client.publish.mock.calls[0][0]).toBe(requestTopic);
    expect(client.publish.mock.calls[0][2]).toEqual({ qos: 1, retain: false });
    expect(client.end).toHaveBeenCalledWith(true);
    expect((connect as jest.Mock).mock.calls[0][1].clientId).not.toBe('shared-status-id');
  });

  it('ignores an unrelated id, wrong source and wrong destination before a valid reply', async () => {
    const { rpc, client } = setup({ responder: req => [
      { id: -1, src: ID, dst: source, result: { id: 0, output: false } },
      { id: req.id, src: 'other-shelly', dst: source, result: { id: 0, output: false } },
      { id: req.id, src: ID, dst: 'unrelated', result: { id: 0, output: false } },
      { id: req.id, src: ID, dst: source, result: { id: 0, output: true } },
    ] });
    const pending = rpc.getSwitchStatus();
    client.emit('connect');
    expect((await pending).output).toBe(true);
  });

  it('fails closed when SUBACK rejects exact response topic, never publishes', async () => {
    const { rpc, client } = setup({ denied: true });
    const pending = rpc.getSwitchStatus();
    client.emit('connect');
    await expect(pending).rejects.toThrow('MQTT_FLESPI_RPC_SUBSCRIBE_DENIED');
    expect(client.publish).not.toHaveBeenCalled();
  });

  it('rejects a matched Shelly error without logging its payload', async () => {
    const { rpc, client } = setup({ responder: req => [{ id: req.id, src: ID, dst: source,
      error: { code: -1, message: 'synthetic-private-diagnostic' } }] });
    const pending = rpc.getSwitchStatus();
    client.emit('connect');
    await expect(pending).rejects.toThrow('MQTT_FLESPI_RPC_DEVICE_ERROR');
  });

  it('rejects malformed matched response and never treats it as power-off', async () => {
    const { rpc, client } = setup({ responder: req => [{ id: req.id, src: ID, dst: source,
      result: { id: 0, output: 'false' } }] });
    const pending = rpc.getSwitchStatus();
    client.emit('connect');
    await expect(pending).rejects.toThrow('MQTT_FLESPI_RPC_INVALID_RESULT');
  });

  it('refuses unscoped sources before opening a network connection', async () => {
    const { rpc, runtime } = setup();
    runtime.config.rpcSource = 'smarthome/dev/v1/backend';
    await expect(rpc.getSwitchStatus()).rejects.toThrow('MQTT_FLESPI_READONLY_RPC_NOT_CONFIGURED');
    expect(connect).not.toHaveBeenCalled();
  });
});
