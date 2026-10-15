import { EventEmitter } from 'node:events';
import { connect, IClientOptions, MqttClient } from 'mqtt';
import { MqttRevocationConnection } from './mqtt-revocation.connection';
import { DYNAMIC_SECURITY_REPLY } from './mosquitto-admin.transport';
jest.mock('mqtt', () => ({ connect: jest.fn() }));
const mqttConnect = jest.mocked(connect);

class SocketFixture extends EventEmitter {
  connected = false;
  options: IClientOptions = {};
  stream = { destroy: jest.fn<void, []>() };
  end = jest.fn<void, [boolean, object, () => void]>(
    (_force, _options, done) => {
      this.connected = false;
      done();
    },
  );
  subscribe(
    topic: string,
    _options: object,
    done: (error: null, grants: { topic: string; qos: number }[]) => void,
  ) {
    done(null, [{ topic, qos: 1 }]);
  }
  publish(_topic: string, body: string, _options: object, done: () => void) {
    done();
    const { commands } = JSON.parse(body) as {
      commands: { command: string; correlationData: string }[];
    };
    this.emit(
      'message',
      DYNAMIC_SECURITY_REPLY,
      Buffer.from(JSON.stringify({ responses: commands })),
      { retain: false },
    );
  }
}

describe('one-use MQTT administrative connection', () => {
  let sockets: SocketFixture[];
  const options: IClientOptions = {
    rejectUnauthorized: true,
    username: 'admin',
    password: 'fixture',
    clientId: 'revoker',
  };
  const id = '11111111-1111-4111-8111-111111111111';
  beforeEach(() => {
    jest.useFakeTimers();
    sockets = [];
    mqttConnect.mockReset();
    mqttConnect.mockImplementation((_url, supplied) => {
      const socket = new SocketFixture();
      socket.options = supplied!;
      sockets.push(socket);
      return socket as unknown as MqttClient;
    });
  });
  afterEach(() => jest.useRealTimers());
  it('requires verified TLS before opening any socket', () => {
    expect(
      () => new MqttRevocationConnection('mqtt://fixture', options),
    ).toThrow('TLS_REQUIRED');
    expect(
      () =>
        new MqttRevocationConnection('mqtts://fixture', {
          ...options,
          rejectUnauthorized: false,
        }),
    ).toThrow('TLS_REQUIRED');
    expect(mqttConnect).not.toHaveBeenCalled();
  });
  it('uses a fresh clean session for every operation, with reconnect and packet queuing disabled', async () => {
    const broker = new MqttRevocationConnection('mqtts://fixture', options);
    for (let index = 0; index < 2; index++) {
      const pending = broker.revoke(id);
      const socket = sockets[index];
      socket.connected = true;
      socket.emit('connect');
      await pending;
      expect(socket.options).toMatchObject({
        clean: true,
        reconnectPeriod: 0,
        queueQoSZero: false,
        protocolVersion: 5,
        protocol: 'mqtts',
      });
      expect(socket.end).toHaveBeenCalledWith(true, {}, expect.any(Function));
      expect(socket.listenerCount('message')).toBe(0);
    }
    expect(mqttConnect).toHaveBeenCalledTimes(2);
  });
  it('redacts connection failures, closes the socket, and can use a new connection on retry', async () => {
    const broker = new MqttRevocationConnection('mqtts://fixture', options);
    const failed = expect(broker.revoke(id)).rejects.toThrow(
      'MQTT_ADMIN_UNAVAILABLE',
    );
    sockets[0].emit('error', new Error('private-password'));
    await failed;
    expect(sockets[0].end).toHaveBeenCalledTimes(1);
    const retried = broker.revoke(id);
    sockets[1].connected = true;
    sockets[1].emit('connect');
    await retried;
    expect(mqttConnect).toHaveBeenCalledTimes(2);
  });
  it('bounds a silent connection attempt and removes its event listeners', async () => {
    const failed = expect(
      new MqttRevocationConnection('mqtts://fixture', options).revoke(id),
    ).rejects.toThrow('MQTT_ADMIN_UNAVAILABLE');
    await jest.advanceTimersByTimeAsync(5000);
    await failed;
    expect(sockets[0].listenerCount('connect')).toBe(0);
    expect(sockets[0].listenerCount('close')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('destroys the stream if MQTT cleanup never acknowledges completion', async () => {
    const failed = expect(
      new MqttRevocationConnection('mqtts://fixture', options).revoke(id),
    ).rejects.toThrow('MQTT_ADMIN_UNAVAILABLE');
    sockets[0].end.mockImplementation(() => {});
    sockets[0].emit('close');
    await jest.advanceTimersByTimeAsync(1000);
    await failed;
    expect(sockets[0].stream.destroy).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed identity IDs before any connection', async () => {
    await expect(
      new MqttRevocationConnection('mqtts://fixture', options).revoke(
        'malformed',
      ),
    ).rejects.toThrow('MQTT_IDENTITY_ID_INVALID');
    expect(mqttConnect).not.toHaveBeenCalled();
  });
});
