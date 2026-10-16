import { EventEmitter } from 'node:events';
import type { MqttClient } from 'mqtt';
import { DeviceMqttPolicy } from './device-mqtt-policy';
import { MosquittoDeviceIdentityAdmin } from './mosquitto-device-identity.admin';
import {
  AdminCommand,
  BrokerAdminError,
  DYNAMIC_SECURITY_REPLY,
  DYNAMIC_SECURITY_TOPIC,
  MosquittoAdminTransport,
} from './mosquitto-admin.transport';

const identityId = '20000000-0000-4000-8000-000000000001';
const otherId = '20000000-0000-4000-8000-000000000002';
const namespace = 'smarthome/unit/v1';
const defaults = {
  acls: ['publishClientSend', 'publishClientReceive', 'subscribe'].map(
    (acltype) => ({ acltype, allow: false }),
  ),
};

describe('device MQTT least-privilege policy and lifecycle', () => {
  const policy = new DeviceMqttPolicy(namespace);
  const execute = jest.fn<Promise<unknown>, [AdminCommand]>();
  let admin: MosquittoDeviceIdentityAdmin;
  beforeEach(() => {
    execute
      .mockReset()
      .mockImplementation((command) =>
        Promise.resolve(
          command.command === 'getDefaultACLAccess' ? defaults : undefined,
        ),
      );
    admin = new MosquittoDeviceIdentityAdmin({ execute }, policy);
  });

  it.each(['', undefined, 'a/+', 'a/#', 'a\n'])(
    'requires a strict namespace (%s)',
    (value) => {
      expect(() => new DeviceMqttPolicy(value as string)).toThrow();
    },
  );

  it.each(['', 'not-uuid', `${identityId}\n`, '$CONTROL', '../admin'])(
    'rejects unsafe identity IDs before any broker command',
    async (id) => {
      await expect(admin.provision(id, 'shelly-a')).rejects.toThrow(
        'MQTT_IDENTITY_ID_INVALID',
      );
      await expect(admin.revoke(id)).rejects.toThrow(
        'MQTT_IDENTITY_ID_INVALID',
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each(['a/b', '+', 'shelly-a\n'])(
    'rejects topic injection before provisioning',
    async (id) => {
      await expect(admin.provision(identityId, id)).rejects.toThrow(
        'MQTT_DEVICE_ID_INVALID',
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('limits a Shelly identity to exact own topics, including its RPC response', () => {
    const a = policy.device(identityId, 'shelly-a');
    const b = policy.device(otherId, 'shelly-b');
    expect(a.clientId).toBe('shelly-a');
    expect(a.username).not.toBe(b.username);
    expect(a.acls).toHaveLength(6);
    expect(
      a.acls.every(
        (acl) => acl.topic.includes('shelly-a') && !/[+#$%\s]/.test(acl.topic),
      ),
    ).toBe(true);
    expect(
      a.acls
        .filter((acl) => acl.acltype === 'subscribeLiteral')
        .map((acl) => acl.topic),
    ).toEqual([`${namespace}/devices/shelly-a/rpc`]);
    expect(a.acls).toContainEqual({
      acltype: 'publishClientSend',
      topic: `${namespace}/backend/devices/shelly-a/rpc`,
      allow: true,
      priority: 0,
    });
  });

  it('limits an internal-protocol device to status publishing and control receiving', () => {
    const device = policy.device(identityId, 'lamp-a');
    expect(device.acls.map((acl) => [acl.acltype, acl.topic])).toEqual([
      ['publishClientSend', `${namespace}/devices/lamp-a/status`],
      ['publishClientReceive', `${namespace}/devices/lamp-a/control`],
      ['subscribeLiteral', `${namespace}/devices/lamp-a/control`],
    ]);
  });

  it('does not grant broker administration to the backend service', () => {
    expect(
      policy.backend().every((acl) => acl.topic.startsWith(namespace + '/')),
    ).toBe(true);
    expect(policy.backend().some((acl) => acl.topic.includes('$CONTROL'))).toBe(
      false,
    );
  });

  it('matches a configured switch component and RPC source without widening device ACLs', () => {
    const device = new DeviceMqttPolicy(
      namespace,
      2,
      `${namespace}/backend/instance-a`,
    ).device(identityId, 'shelly-a');
    expect(
      device.acls.some((acl) => acl.topic.endsWith('/status/switch:2')),
    ).toBe(true);
    expect(
      device.acls.some(
        (acl) =>
          acl.topic === `${namespace}/backend/instance-a/devices/shelly-a/rpc`,
      ),
    ).toBe(true);
  });

  it('returns independent 256-bit credentials only after broker acknowledgement', async () => {
    const a = await admin.provision(identityId, 'shelly-a');
    const b = await admin.provision(otherId, 'shelly-b');
    expect(Buffer.from(a.password, 'base64url')).toHaveLength(32);
    expect(a.password).not.toBe(b.password);
    expect(JSON.stringify(a.identity).includes(a.password)).toBe(false);
    const commands = execute.mock.calls.map(([command]) => command);
    expect(commands[0].command).toBe('getDefaultACLAccess');
    expect(commands[1].command).toBe('createRole');
    expect(commands[2]).toMatchObject({
      command: 'createClient',
      username: a.identity.username,
      clientid: 'shelly-a',
      roles: [{ rolename: a.identity.roleName, priority: 0 }],
    });
    expect(commands[2].password === a.password).toBe(true);
  });

  it.each([
    undefined,
    null,
    {},
    { acls: [] },
    { acls: defaults.acls.map((acl) => ({ ...acl, allow: true })) },
    { acls: [...defaults.acls, defaults.acls[0]] },
  ])(
    'fails closed when broker default ACLs are not explicitly deny',
    async (data) => {
      execute.mockResolvedValue(data);
      await expect(
        admin.provision(identityId, 'shelly-a'),
      ).rejects.toMatchObject({ code: 'MQTT_ADMIN_UNSAFE_DEFAULT_ACL' });
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it('does not create a client if role creation is rejected', async () => {
    execute
      .mockResolvedValueOnce(defaults)
      .mockRejectedValueOnce(new BrokerAdminError('MQTT_ADMIN_REJECTED'));
    await expect(admin.provision(identityId, 'shelly-a')).rejects.toMatchObject(
      { code: 'MQTT_ADMIN_REJECTED' },
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not return a credential or claim rollback after an ambiguous client creation', async () => {
    execute
      .mockResolvedValueOnce(defaults)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new BrokerAdminError('MQTT_ADMIN_OUTCOME_UNKNOWN'),
      );
    await expect(admin.provision(identityId, 'shelly-a')).rejects.toMatchObject(
      { code: 'MQTT_ADMIN_OUTCOME_UNKNOWN' },
    );
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('revokes directly even when current broker defaults cannot be queried', async () => {
    await admin.revoke(identityId);
    expect(execute.mock.calls[0][0]).toEqual({
      command: 'disableClient',
      username: `device-${identityId}`,
    });
  });

  it('disables before rotation and does not re-enable after password update failure', async () => {
    execute
      .mockResolvedValueOnce(defaults)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new BrokerAdminError('MQTT_ADMIN_REJECTED'));
    await expect(admin.rotate(identityId)).rejects.toMatchObject({
      code: 'MQTT_ADMIN_REJECTED',
    });
    expect(execute.mock.calls.map(([command]) => command.command)).toEqual([
      'getDefaultACLAccess',
      'disableClient',
      'setClientPassword',
    ]);
  });
});

class FakeAdminClient extends EventEmitter {
  connected = true;
  options = {
    protocol: 'mqtts',
    rejectUnauthorized: true,
    reconnectPeriod: 0,
    clean: true,
  };
  subscribe = jest.fn(
    (
      _topic: string,
      _options: unknown,
      callback: (
        error: Error | null,
        granted?: { topic: string; qos: number }[],
      ) => void,
    ) => callback(null, [{ topic: DYNAMIC_SECURITY_REPLY, qos: 1 }]),
  );
  publish = jest.fn(
    (
      _topic: string,
      _payload: string,
      _options: unknown,
      callback: (error?: Error) => void,
    ) => callback(),
  );
}

describe('Mosquitto administration transport failure semantics', () => {
  let client: FakeAdminClient;
  let transport: MosquittoAdminTransport;
  beforeEach(() => {
    jest.useFakeTimers();
    client = new FakeAdminClient();
    transport = new MosquittoAdminTransport(
      client as unknown as MqttClient,
      1000,
    );
  });
  afterEach(() => {
    transport.close();
    jest.useRealTimers();
  });

  const command = {
    command: 'disableClient',
    username: `device-${identityId}`,
  };
  function reply(
    index: number,
    override: Record<string, unknown> = {},
    retained = false,
  ) {
    const request = JSON.parse(client.publish.mock.calls[index][1]) as {
      commands: { command: string; correlationData: string }[];
    };
    client.emit(
      'message',
      DYNAMIC_SECURITY_REPLY,
      Buffer.from(
        JSON.stringify({
          responses: [
            {
              command: request.commands[0].command,
              correlationData: request.commands[0].correlationData,
              ...override,
            },
          ],
        }),
      ),
      { retain: retained },
    );
  }

  it('requires verified TLS for the privileged channel', () => {
    client.options.protocol = 'mqtt';
    expect(
      () => new MosquittoAdminTransport(client as unknown as MqttClient),
    ).toThrow('MQTT_ADMIN_TLS_REQUIRED');
    client.options.protocol = 'mqtts';
    client.options.rejectUnauthorized = false;
    expect(
      () => new MosquittoAdminTransport(client as unknown as MqttClient),
    ).toThrow('MQTT_ADMIN_TLS_REQUIRED');
  });

  it('rejects automatic reconnect and persistent sessions for administrative commands', () => {
    client.options.reconnectPeriod = 1000;
    expect(
      () => new MosquittoAdminTransport(client as unknown as MqttClient),
    ).toThrow('MQTT_ADMIN_SESSION_UNSAFE');
    client.options.reconnectPeriod = 0;
    client.options.clean = false;
    expect(
      () => new MosquittoAdminTransport(client as unknown as MqttClient),
    ).toThrow('MQTT_ADMIN_SESSION_UNSAFE');
  });

  it('waits for the correlated command response, not just PUBACK', async () => {
    const pending = transport.execute(command);
    let completed = false;
    void pending.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(client.publish.mock.calls[0][0]).toBe(DYNAMIC_SECURITY_TOPIC);
    expect(client.publish.mock.calls[0][2]).toEqual({ qos: 1, retain: false });
    reply(0);
    await pending;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('correlates concurrent responses received out of order', async () => {
    const first = transport.execute(command);
    const second = transport.execute({ ...command, command: 'getClient' });
    reply(1, { data: { marker: 2 } });
    reply(0, { data: { marker: 1 } });
    await expect(first).resolves.toEqual({ marker: 1 });
    await expect(second).resolves.toEqual({ marker: 2 });
  });

  it('rejects broker errors without echoing their message or a secret', async () => {
    const pending = transport.execute(command);
    reply(0, { error: 'synthetic-sensitive-reply' });
    await expect(pending).rejects.toThrow(
      new BrokerAdminError('MQTT_ADMIN_REJECTED'),
    );
  });

  it('rejects a mismatched command response', async () => {
    const pending = transport.execute(command);
    reply(0, { command: 'enableClient' });
    await expect(pending).rejects.toMatchObject({
      code: 'MQTT_ADMIN_INVALID_RESPONSE',
    });
  });

  it('ignores retained, unrelated, oversized and malformed replies and reports uncertainty', async () => {
    const pending = transport.execute(command);
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'MQTT_ADMIN_OUTCOME_UNKNOWN',
    });
    reply(0, {}, true);
    reply(0, { correlationData: 'unrelated' });
    client.emit('message', DYNAMIC_SECURITY_REPLY, Buffer.from('{bad'), {
      retain: false,
    });
    client.emit('message', DYNAMIC_SECURITY_REPLY, Buffer.alloc(65537), {
      retain: false,
    });
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not send after a stalled SUBACK times out', async () => {
    let ack: Parameters<FakeAdminClient['subscribe']>[2] | undefined;
    client.subscribe.mockImplementation((_topic, _options, callback) => {
      ack = callback;
    });
    const pending = transport.execute(command);
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'MQTT_ADMIN_UNAVAILABLE',
    });
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    ack?.(null, [{ topic: DYNAMIC_SECURITY_REPLY, qos: 1 }]);
    expect(client.publish).not.toHaveBeenCalled();
  });

  it('rejects a denied administrative subscription before publishing', async () => {
    client.subscribe.mockImplementation((_topic, _options, callback) =>
      callback(null, [{ topic: DYNAMIC_SECURITY_REPLY, qos: 135 }]),
    );
    await expect(transport.execute(command)).rejects.toMatchObject({
      code: 'MQTT_ADMIN_UNAVAILABLE',
    });
    expect(client.publish).not.toHaveBeenCalled();
  });

  it('fails an in-flight operation on disconnect without replaying it', async () => {
    const pending = transport.execute(command);
    client.connected = false;
    client.emit('close');
    await expect(pending).rejects.toMatchObject({
      code: 'MQTT_ADMIN_OUTCOME_UNKNOWN',
    });
    await expect(transport.execute(command)).rejects.toMatchObject({
      code: 'MQTT_ADMIN_UNAVAILABLE',
    });
    expect(client.publish).toHaveBeenCalledTimes(1);
    client.connected = true;
    await expect(transport.execute(command)).rejects.toThrow(
      'MQTT_ADMIN_UNAVAILABLE',
    );
  });

  it('bounds the number of pending commands', async () => {
    const pending = Array.from({ length: 32 }, () =>
      transport.execute(command).catch((error) => error as BrokerAdminError),
    );
    await expect(transport.execute(command)).rejects.toThrow(
      'MQTT_ADMIN_UNAVAILABLE',
    );
    transport.close();
    const results = await Promise.all(pending);
    expect(results.every((result) => result instanceof BrokerAdminError)).toBe(
      true,
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('redacts publish errors and cleans up its listeners on close', async () => {
    client.publish.mockImplementation((_topic, _payload, _options, callback) =>
      callback(new Error('synthetic-sensitive-error')),
    );
    await expect(transport.execute(command)).rejects.toThrow(
      'MQTT_ADMIN_OUTCOME_UNKNOWN',
    );
    transport.close();
    expect(client.listenerCount('message')).toBe(0);
    expect(client.listenerCount('close')).toBe(0);
    expect(client.listenerCount('error')).toBe(0);
    await expect(transport.execute(command)).rejects.toThrow(
      'MQTT_ADMIN_UNAVAILABLE',
    );
  });
});
