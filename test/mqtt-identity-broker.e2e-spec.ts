import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { ConnectionOptions } from 'node:tls';
import { connect, IClientOptions, MqttClient, Packet } from 'mqtt';
import { DeviceMqttPolicy } from '../src/modules/devices/infrastructure/messaging/identity/device-mqtt-policy';
import {
  AdminCommand,
  BrokerAdminError,
  MosquittoAdminTransport,
} from '../src/modules/devices/infrastructure/messaging/identity/mosquitto-admin.transport';
import { MosquittoDeviceIdentityAdmin } from '../src/modules/devices/infrastructure/messaging/identity/mosquitto-device-identity.admin';

// Only the harness can supply a fresh loopback broker and temporary CA.
const brokerSuite = process.env.HU11_TEST_BROKER ? describe : describe.skip;
brokerSuite('HU11 real Mosquitto TLS/ACL with two simulated devices', () => {
  const namespace = 'smarthome/hu11-test/v1';
  const policy = new DeviceMqttPolicy(namespace);
  const clients = new Set<MqttClient>();
  let brokerUrl: string;
  let ca: Buffer;
  let adminClient: MqttClient;
  let serviceClient: MqttClient;
  let transport: MosquittoAdminTransport;
  let identities: MosquittoDeviceIdentityAdmin;
  type Issued = Awaited<ReturnType<MosquittoDeviceIdentityAdmin['provision']>>;
  let a: Issued;
  let b: Issued;
  let servicePassword: string;
  const preparationPasswords: string[] = [];

  function observedAdmin(after?: (command: AdminCommand) => void) {
    return new MosquittoDeviceIdentityAdmin(
      {
        execute: async (command) => {
          if (typeof command.password === 'string')
            preparationPasswords.push(command.password);
          const response = await transport.execute(command);
          after?.(command);
          return response;
        },
      },
      policy,
    );
  }

  function open(options: IClientOptions = {}): Promise<MqttClient> {
    return new Promise((resolveClient, reject) => {
      const connection: IClientOptions & Pick<ConnectionOptions, 'minVersion'> =
        {
          protocolVersion: 5,
          clean: true,
          reconnectPeriod: 0,
          connectTimeout: 2000,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          ca,
          clientId: `test-${randomUUID()}`,
          ...options,
        };
      const client = connect(brokerUrl, connection);
      clients.add(client);
      let connack: number | undefined;
      client.on('packetreceive', (packet) => {
        if (packet.cmd === 'connack') connack = packet.reasonCode;
      });
      client.on('error', () => {});
      const timer = setTimeout(() => {
        client.end(true);
        reject(new Error('MQTT_TEST_CONNECT_TIMEOUT'));
      }, 3000);
      client.once('connect', () => {
        clearTimeout(timer);
        resolveClient(client);
      });
      client.once('error', (error) => {
        clearTimeout(timer);
        client.end(true);
        const code = connack ?? ('code' in error ? error.code : 'UNKNOWN');
        reject(new Error(`MQTT_TEST_CONNECT_FAILED:${String(code)}`));
      });
    });
  }
  const asDevice = (issued: Issued, overrides: IClientOptions = {}) =>
    open({
      username: issued.identity.username,
      password: issued.password,
      clientId: issued.identity.clientId,
      ...overrides,
    });

  function subscribeCode(client: MqttClient, topic: string): Promise<number> {
    return new Promise((resolveCode, reject) => {
      let code: number | undefined;
      const onPacket = (packet: Packet) => {
        if (packet.cmd === 'suback' && typeof packet.granted[0] === 'number')
          code = packet.granted[0];
      };
      const timer = setTimeout(() => {
        client.off('packetreceive', onPacket);
        reject(new Error('SUBACK_TIMEOUT'));
      }, 2000);
      client.on('packetreceive', onPacket);
      client.subscribe(topic, { qos: 1 }, () => {
        clearTimeout(timer);
        client.off('packetreceive', onPacket);
        if (code === undefined) reject(new Error('SUBACK_MISSING'));
        else resolveCode(code);
      });
    });
  }

  function publishCode(
    client: MqttClient,
    topic: string,
    payload = '{}',
  ): Promise<number> {
    return new Promise((resolveCode, reject) => {
      let code: number | undefined;
      const onPacket = (packet: { cmd: string; reasonCode?: number }) => {
        if (packet.cmd === 'puback') code = packet.reasonCode ?? 0;
      };
      const timer = setTimeout(() => {
        client.off('packetreceive', onPacket);
        reject(new Error('PUBACK_TIMEOUT'));
      }, 2000);
      client.on('packetreceive', onPacket);
      client.publish(topic, payload, { qos: 1, retain: false }, () => {
        clearTimeout(timer);
        client.off('packetreceive', onPacket);
        if (code === undefined) reject(new Error('PUBACK_MISSING'));
        else resolveCode(code);
      });
    });
  }

  function nextMessage(client: MqttClient, topic: string): Promise<string> {
    return new Promise((resolveMessage, reject) => {
      const onMessage = (received: string, payload: Buffer) => {
        if (received !== topic) return;
        clearTimeout(timer);
        client.off('message', onMessage);
        resolveMessage(payload.toString('utf8'));
      };
      const timer = setTimeout(() => {
        client.off('message', onMessage);
        reject(new Error('MESSAGE_TIMEOUT'));
      }, 2000);
      client.on('message', onMessage);
    });
  }

  function closed(client: MqttClient): Promise<void> {
    return new Promise((resolveClose, reject) => {
      const timer = setTimeout(
        () => reject(new Error('REVOKE_DISCONNECT_TIMEOUT')),
        2000,
      );
      client.once('close', () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  }

  beforeAll(async () => {
    brokerUrl = process.env.HU11_TEST_BROKER!;
    if (!/^mqtts:\/\/127\.0\.0\.1:\d+$/.test(brokerUrl))
      throw new Error('Disposable loopback broker required');
    const caPath = resolve(process.env.HU11_TEST_CA!);
    if (!caPath.startsWith(resolve('.tmp') + sep))
      throw new Error('Temporary test CA required');
    ca = readFileSync(caPath);
    adminClient = await open({
      username: 'hu11-fixture-admin',
      password: process.env.HU11_TEST_ADMIN_PASSWORD,
      clientId: 'hu11-fixture-admin',
    });
    transport = new MosquittoAdminTransport(adminClient);
    identities = new MosquittoDeviceIdentityAdmin(transport, policy);
    a = await identities.provision(randomUUID(), 'shelly-simulated-a');
    b = await identities.provision(randomUUID(), 'shelly-simulated-b');
    servicePassword = randomBytes(32).toString('base64url');
    await transport.execute({
      command: 'createRole',
      rolename: 'hu11-service',
      acls: policy.backend(),
    });
    await transport.execute({
      command: 'createClient',
      username: 'hu11-service',
      password: servicePassword,
      clientid: 'hu11-service',
      roles: [{ rolename: 'hu11-service', priority: 0 }],
    });
    serviceClient = await open({
      username: 'hu11-service',
      password: servicePassword,
      clientId: 'hu11-service',
    });
  }, 30000);

  afterEach(async () => {
    for (const client of clients) {
      if (client === adminClient || client === serviceClient) continue;
      await client.endAsync(true);
      clients.delete(client);
    }
  });
  afterAll(async () => {
    transport?.close();
    for (const client of clients) await client.endAsync(true);
    clients.clear();
  });

  it('accepts a trusted certificate and individual authentication', async () => {
    const client = await asDevice(a);
    expect(client.connected).toBe(true);
    expect(a.password).not.toBe(b.password);
    expect(a.identity.username).not.toBe(b.identity.username);
  });

  it('rejects an untrusted certificate', async () => {
    await expect(asDevice(a, { ca: undefined })).rejects.toThrow(
      /SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY/,
    );
  });

  it('rejects an incorrect certificate hostname', async () => {
    await expect(
      asDevice(a, { servername: 'not-the-fixture.example.test' }),
    ).rejects.toThrow('ERR_TLS_CERT_ALTNAME_INVALID');
  });

  it('rejects anonymous clients at CONNACK', async () => {
    await expect(open()).rejects.toThrow('MQTT_TEST_CONNECT_FAILED:135');
  });

  it('rejects the wrong device password at CONNACK', async () => {
    await expect(asDevice(a, { password: b.password })).rejects.toThrow(
      'MQTT_TEST_CONNECT_FAILED:135',
    );
  });

  it('binds credentials to the client ID so A cannot evict B by choosing its ID', async () => {
    const other = await asDevice(b);
    await expect(
      asDevice(a, { clientId: b.identity.clientId }),
    ).rejects.toThrow('MQTT_TEST_CONNECT_FAILED:135');
    expect(other.connected).toBe(true);
  });

  it('delivers an authorized backend command only to its device', async () => {
    const client = await asDevice(a);
    const topic = `${a.identity.topicPrefix}/rpc`;
    expect(await subscribeCode(client, topic)).toBe(1);
    const message = nextMessage(client, topic);
    expect(
      await publishCode(serviceClient, topic, '{"method":"Switch.Set"}'),
    ).toBe(0);
    expect(await message).toBe('{"method":"Switch.Set"}');
  });

  it('delivers own telemetry to the backend', async () => {
    const client = await asDevice(a);
    const filter = `${namespace}/devices/+/status/switch:0`;
    const topic = `${a.identity.topicPrefix}/status/switch:0`;
    expect(await subscribeCode(serviceClient, filter)).toBe(1);
    const message = nextMessage(serviceClient, topic);
    expect(await publishCode(client, topic, '{"output":true}')).toBe(0);
    expect(await message).toBe('{"output":true}');
  });

  it('accepts MQTT 3.1.1 with the same credential and own control topic', async () => {
    const client = await asDevice(a, { protocolVersion: 4 });
    const topic = `${a.identity.topicPrefix}/rpc`;
    expect(await subscribeCode(client, topic)).toBe(1);
    const message = nextMessage(client, topic);
    await publishCode(serviceClient, topic, '{"id":31}');
    expect(await message).toBe('{"id":31}');
  });

  it.each(['rpc', 'control', 'status/switch:0', 'events/rpc', 'online'])(
    'denies A publishing to B/%s with an explicit negative PUBACK',
    async (suffix) => {
      const client = await asDevice(a);
      expect(
        await publishCode(client, `${b.identity.topicPrefix}/${suffix}`),
      ).toBe(135);
    },
  );

  it.each([
    '#',
    'smarthome/hu11-test/v1/devices/+/rpc',
    'smarthome/hu11-test/v1/devices/shelly-simulated-b/rpc',
    '$CONTROL/dynamic-security/v1/response',
    '$SYS/#',
  ])('denies A subscribing to %s with a negative SUBACK', async (filter) => {
    expect(
      await subscribeCode(await asDevice(a), filter),
    ).toBeGreaterThanOrEqual(128);
  });

  it('denies a device publishing commands even to its own RPC topic', async () => {
    expect(
      await publishCode(await asDevice(a), `${a.identity.topicPrefix}/rpc`),
    ).toBe(135);
  });

  it('isolates RPC responses per device', async () => {
    const client = await asDevice(a);
    const topic = `${namespace}/backend/devices/${a.identity.clientId}/rpc`;
    expect(
      await subscribeCode(serviceClient, `${namespace}/backend/devices/+/rpc`),
    ).toBe(1);
    const message = nextMessage(serviceClient, topic);
    expect(await publishCode(client, topic, '{"id":1,"result":null}')).toBe(0);
    await message;
    expect(
      await publishCode(
        client,
        `${namespace}/backend/devices/${b.identity.clientId}/rpc`,
      ),
    ).toBe(135);
  });

  it('denies access to another namespace', async () => {
    expect(
      await publishCode(
        await asDevice(a),
        'smarthome/production/v1/devices/shelly-simulated-a/events/rpc',
      ),
    ).toBe(135);
  });

  it('denies device and backend-service access to broker administration', async () => {
    expect(
      await publishCode(await asDevice(a), '$CONTROL/dynamic-security/v1'),
    ).toBe(135);
    expect(
      await publishCode(serviceClient, '$CONTROL/dynamic-security/v1'),
    ).toBe(135);
    expect(
      await subscribeCode(
        serviceClient,
        '$CONTROL/dynamic-security/v1/response',
      ),
    ).toBeGreaterThanOrEqual(128);
  });

  it('rejects duplicate identity creation instead of modifying existing credentials', async () => {
    await expect(
      identities.provision(a.identity.identityId, a.identity.clientId),
    ).rejects.toMatchObject({ code: 'MQTT_ADMIN_REJECTED' });
    expect((await asDevice(a)).connected).toBe(true);
  });

  it('prepares a credential that stays disabled under MQTT 5 and 3.1.1 until explicit test activation', async () => {
    const id = randomUUID();
    const manufacturer = `shelly-prepared-${id}`;
    const start = preparationPasswords.length;
    const prepared = await observedAdmin().prepare(id, manufacturer);
    expect(prepared.brokerState).toBe('DISABLED');
    expect((await identities.inspect(id, manufacturer)).brokerState).toBe(
      'DISABLED',
    );
    await expect(asDevice(prepared)).rejects.toThrow(
      'MQTT_TEST_CONNECT_FAILED:135',
    );
    await expect(asDevice(prepared, { protocolVersion: 4 })).rejects.toThrow(
      'MQTT_TEST_CONNECT_FAILED:5',
    );
    const bootstrap = preparationPasswords[start];
    expect(bootstrap === prepared.password).toBe(false);
    // Test-only activation proves the final credential/ACL without introducing
    // a production activation API or claiming possession/pairing completion.
    await transport.execute({
      command: 'enableClient',
      username: prepared.identity.username,
    });
    await expect(asDevice(prepared, { password: bootstrap })).rejects.toThrow(
      'MQTT_TEST_CONNECT_FAILED:135',
    );
    const live = await asDevice(prepared);
    expect(
      await subscribeCode(live, `${prepared.identity.topicPrefix}/rpc`),
    ).toBe(1);
    expect(
      await publishCode(live, `${prepared.identity.topicPrefix}/events/rpc`),
    ).toBeLessThan(128);
    expect(
      await publishCode(live, `${b.identity.topicPrefix}/events/rpc`),
    ).toBe(135);
    const disconnected = closed(live);
    await identities.revoke(id);
    await disconnected;
    await expect(asDevice(prepared)).rejects.toThrow(
      'MQTT_TEST_CONNECT_FAILED:135',
    );
  });

  it('inspects an enabled identity without changing its session or ACL', async () => {
    const live = await asDevice(b);
    expect(
      await identities.inspect(b.identity.identityId, b.identity.clientId),
    ).toEqual({ identity: b.identity, brokerState: 'ENABLED' });
    expect(live.connected).toBe(true);
    expect(
      await publishCode(live, `${b.identity.topicPrefix}/events/rpc`),
    ).toBeLessThan(128);
  });

  it('refuses duplicate preparation without changing an existing enabled identity', async () => {
    const live = await asDevice(b);
    await expect(
      observedAdmin().prepare(b.identity.identityId, b.identity.clientId),
    ).rejects.toMatchObject({ code: 'MQTT_ADMIN_REJECTED' });
    expect(live.connected).toBe(true);
    expect(
      (await identities.inspect(b.identity.identityId, b.identity.clientId))
        .brokerState,
    ).toBe('ENABLED');
  });

  it('keeps a lost create acknowledgement uncertain even when inspection finds an enabled temporary identity', async () => {
    const id = randomUUID();
    const manufacturer = `shelly-create-uncertain-${id}`;
    const start = preparationPasswords.length;
    const commands: string[] = [];
    const uncertain = observedAdmin((command) => {
      commands.push(command.command);
      if (command.command === 'createClient')
        throw new BrokerAdminError('MQTT_ADMIN_OUTCOME_UNKNOWN');
    });
    await expect(uncertain.prepare(id, manufacturer)).rejects.toMatchObject({
      code: 'MQTT_ADMIN_OUTCOME_UNKNOWN',
    });
    expect(commands).toEqual([
      'getDefaultACLAccess',
      'createRole',
      'createClient',
    ]);
    expect(preparationPasswords.length - start).toBe(1);
    expect((await identities.inspect(id, manufacturer)).brokerState).toBe(
      'ENABLED',
    );
    await expect(identities.prepare(id, manufacturer)).rejects.toMatchObject({
      code: 'MQTT_ADMIN_REJECTED',
    });
    // Preparation returned no credential, but this outcome still needs durable
    // reconciliation. Only this isolated test explicitly disables the orphan.
    await identities.revoke(id);
    expect((await identities.inspect(id, manufacturer)).brokerState).toBe(
      'DISABLED',
    );
  });

  it.each(['disableClient', 'setClientPassword'])(
    'does not deliver credentials after a lost %s acknowledgement, and a fresh inspection recovers disabled state',
    async (stage) => {
      const id = randomUUID();
      const manufacturer = `shelly-uncertain-${id}`;
      const start = preparationPasswords.length;
      const uncertain = observedAdmin((command) => {
        if (command.command === stage)
          throw new BrokerAdminError('MQTT_ADMIN_OUTCOME_UNKNOWN');
      });
      await expect(uncertain.prepare(id, manufacturer)).rejects.toMatchObject({
        code: 'MQTT_ADMIN_OUTCOME_UNKNOWN',
      });
      expect(preparationPasswords.length - start).toBe(
        stage === 'disableClient' ? 1 : 2,
      );
      const observed = await identities.inspect(id, manufacturer);
      expect(observed.brokerState).toBe('DISABLED');
      for (const password of preparationPasswords.slice(start)) {
        await expect(
          asDevice({ identity: observed.identity, password }),
        ).rejects.toThrow('MQTT_TEST_CONNECT_FAILED:135');
      }
      // No automatic adoption/reissuance when the previous outcome was uncertain.
      await expect(identities.prepare(id, manufacturer)).rejects.toMatchObject({
        code: 'MQTT_ADMIN_REJECTED',
      });
    },
  );

  it('does not report successful preparation when an administrator re-enables before final inspection', async () => {
    const id = randomUUID();
    const manufacturer = `shelly-race-${id}`;
    const racing = new MosquittoDeviceIdentityAdmin(
      {
        execute: async (command) => {
          const response = await transport.execute(command);
          if (command.command === 'setClientPassword')
            await transport.execute({
              command: 'enableClient',
              username: command.username,
            });
          return response;
        },
      },
      policy,
    );
    await expect(racing.prepare(id, manufacturer)).rejects.toMatchObject({
      code: 'MQTT_IDENTITY_POLICY_MISMATCH',
    });
    expect((await identities.inspect(id, manufacturer)).brokerState).toBe(
      'ENABLED',
    );
    // The caller must reconcile failures; only this isolated test invokes cleanup.
    await identities.revoke(id);
  });

  it.each(['client-id', 'role', 'group', 'acl'])(
    'rejects observed %s drift without repairing or enabling the identity',
    async (drift) => {
      const id = randomUUID();
      const manufacturer = `shelly-drift-${id}`;
      const prepared = await observedAdmin().prepare(id, manufacturer);
      const username = prepared.identity.username;
      if (drift === 'client-id') {
        await transport.execute({
          command: 'setClientId',
          username,
          clientid: 'different-device',
        });
      } else if (drift === 'role') {
        await transport.execute({
          command: 'createRole',
          rolename: `extra-${id}`,
          acls: [],
        });
        await transport.execute({
          command: 'addClientRole',
          username,
          rolename: `extra-${id}`,
          priority: 0,
        });
      } else if (drift === 'group') {
        await transport.execute({
          command: 'createGroup',
          groupname: `extra-${id}`,
        });
        await transport.execute({
          command: 'addGroupClient',
          username,
          groupname: `extra-${id}`,
          priority: 0,
        });
      } else {
        await transport.execute({
          command: 'modifyRole',
          rolename: prepared.identity.roleName,
          acls: [
            ...prepared.identity.acls,
            {
              acltype: 'publishClientSend',
              topic: '#',
              priority: 0,
              allow: true,
            },
          ],
        });
      }
      await expect(identities.inspect(id, manufacturer)).rejects.toMatchObject({
        code: 'MQTT_IDENTITY_POLICY_MISMATCH',
      });
      await expect(asDevice(prepared)).rejects.toThrow(
        'MQTT_TEST_CONNECT_FAILED:135',
      );
      const raw = (await transport.execute({
        command: 'getClient',
        username,
      })) as { client: { disabled: boolean } };
      expect(raw.client.disabled).toBe(true);
    },
  );

  it('rejects permissive default ACLs during inspection without changing them or enabling the identity', async () => {
    const id = randomUUID();
    const manufacturer = `shelly-defaults-${id}`;
    const prepared = await observedAdmin().prepare(id, manufacturer);
    try {
      await transport.execute({
        command: 'setDefaultACLAccess',
        acls: [{ acltype: 'publishClientSend', allow: true }],
      });
      await expect(identities.inspect(id, manufacturer)).rejects.toMatchObject({
        code: 'MQTT_ADMIN_UNSAFE_DEFAULT_ACL',
      });
      const defaults = (await transport.execute({
        command: 'getDefaultACLAccess',
      })) as {
        acls: { acltype: string; allow: boolean }[];
      };
      expect(defaults.acls).toContainEqual({
        acltype: 'publishClientSend',
        allow: true,
      });
      await expect(asDevice(prepared)).rejects.toThrow(
        'MQTT_TEST_CONNECT_FAILED:135',
      );
    } finally {
      await transport.execute({
        command: 'setDefaultACLAccess',
        acls: [{ acltype: 'publishClientSend', allow: false }],
      });
    }
    expect((await identities.inspect(id, manufacturer)).brokerState).toBe(
      'DISABLED',
    );
  });

  it('does not equate an inspection rejection with an absent or safely revoked identity', async () => {
    await expect(
      identities.inspect(randomUUID(), 'shelly-missing'),
    ).rejects.toMatchObject({ code: 'MQTT_ADMIN_REJECTED' });
  });

  it('rotates A by disconnecting it and rejecting the old password', async () => {
    const client = await asDevice(a);
    const disconnect = closed(client);
    const previous = a.password;
    const result = await identities.rotate(a.identity.identityId);
    await disconnect;
    await expect(asDevice(a)).rejects.toThrow('MQTT_TEST_CONNECT_FAILED:135');
    a.password = result.password;
    expect(result.password).not.toBe(previous);
    expect((await asDevice(a)).connected).toBe(true);
  });

  it('revokes an open connection and denies reconnect while keeping B available', async () => {
    const client = await asDevice(a);
    const disconnect = closed(client);
    await identities.revoke(a.identity.identityId);
    await disconnect;
    expect(client.connected).toBe(false);
    await expect(asDevice(a)).rejects.toThrow('MQTT_TEST_CONNECT_FAILED:135');
    expect((await asDevice(b)).connected).toBe(true);
    // Revocation is idempotent for an existing disabled broker identity.
    await identities.revoke(a.identity.identityId);
  });

  it('persists broker verifiers without the issued plaintext passwords', () => {
    const container = process.env.HU11_TEST_CONTAINER!;
    if (!/^smarthome-hu11-test-[0-9a-f-]{36}$/.test(container))
      throw new Error('Unexpected test container');
    const state = execFileSync(
      'docker',
      ['exec', container, 'cat', '/run/hu11/dynamic-security.json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
        windowsHide: true,
      },
    );
    for (const password of [
      a.password,
      b.password,
      servicePassword,
      process.env.HU11_TEST_ADMIN_PASSWORD!,
      ...preparationPasswords,
    ]) {
      expect(state.includes(password)).toBe(false);
    }
    const saved = JSON.parse(state) as {
      clients: {
        username: string;
        password: string;
        salt: string;
        iterations: number;
        disabled?: boolean;
      }[];
    };
    const device = saved.clients.find(
      (item) => item.username === a.identity.username,
    )!;
    expect(device.disabled).toBe(true);
    expect(Buffer.from(device.password, 'base64')).toHaveLength(64);
    expect(Buffer.from(device.salt, 'base64')).toHaveLength(12);
    expect(device.iterations).toBeGreaterThan(0);
  });

  it('also disconnects and rejects a revoked MQTT 3.1.1 client', async () => {
    const client = await asDevice(b, { protocolVersion: 4 });
    const disconnect = closed(client);
    await identities.revoke(b.identity.identityId);
    await disconnect;
    await expect(asDevice(b, { protocolVersion: 4 })).rejects.toThrow(
      'MQTT_TEST_CONNECT_FAILED:5',
    );
  });
});
