import { DeviceMqttPolicy } from './device-mqtt-policy';
import { AdminCommand, BrokerAdminError } from './mosquitto-admin.transport';
import { MosquittoDeviceIdentityAdmin } from './mosquitto-device-identity.admin';
import { MqttIdentityPolicyError } from './mqtt-identity-snapshot';

const identityId = '20000000-0000-4000-8000-000000000001';
const manufacturer = 'shelly-preparation';
const policy = new DeviceMqttPolicy('smarthome/prepare/v1');
const expected = policy.device(identityId, manufacturer);
const defaults = {
  acls: ['publishClientSend', 'publishClientReceive', 'subscribe'].map(
    (acltype) => ({ acltype, allow: false }),
  ),
};

describe('MQTT identity preparation and read-only inspection', () => {
  let role: Record<string, unknown>;
  let client: Record<string, unknown>;
  let execute: jest.Mock<Promise<unknown>, [AdminCommand]>;
  let admin: MosquittoDeviceIdentityAdmin;
  beforeEach(() => {
    role = {
      rolename: expected.roleName,
      acls: expected.acls.map((acl) => ({ ...acl })),
    };
    client = {
      username: expected.username,
      clientid: manufacturer,
      disabled: true,
      roles: [{ rolename: expected.roleName, priority: 0 }],
      groups: [],
    };
    execute = jest
      .fn<Promise<unknown>, [AdminCommand]>()
      .mockImplementation((command) => {
        if (command.command === 'getDefaultACLAccess')
          return Promise.resolve(defaults);
        if (command.command === 'getRole') return Promise.resolve({ role });
        if (command.command === 'getClient') return Promise.resolve({ client });
        return Promise.resolve(undefined);
      });
    admin = new MosquittoDeviceIdentityAdmin({ execute }, policy);
  });

  it('installs the delivered password only after disable, verifies it stays disabled and never enables', async () => {
    const prepared = await admin.prepare(identityId, manufacturer);
    expect(prepared.brokerState).toBe('DISABLED');
    expect(prepared.identity).toEqual(expected);
    expect(Buffer.from(prepared.password, 'base64url')).toHaveLength(32);
    const commands = execute.mock.calls.map(([command]) => command);
    expect(commands.map((command) => command.command)).toEqual([
      'getDefaultACLAccess',
      'createRole',
      'createClient',
      'disableClient',
      'setClientPassword',
      'getDefaultACLAccess',
      'getRole',
      'getClient',
    ]);
    expect(commands[2].password === prepared.password).toBe(false);
    expect(commands[4].password === prepared.password).toBe(true);
    expect(commands[2]).not.toHaveProperty('disabled');
  });

  it('does not resolve a preparation before the final broker observation', async () => {
    let observe!: (value: unknown) => void;
    const normal = execute.getMockImplementation()!;
    execute.mockImplementation((command) =>
      command.command === 'getClient'
        ? new Promise((resolve) => {
            observe = resolve;
          })
        : normal(command),
    );
    let returned = false;
    const preparing = admin.prepare(identityId, manufacturer).then((value) => {
      returned = true;
      return value;
    });
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(returned).toBe(false);
    observe({ client });
    await expect(preparing).resolves.toMatchObject({ brokerState: 'DISABLED' });
  });

  it.each([
    'createRole',
    'createClient',
    'disableClient',
    'setClientPassword',
    'getRole',
    'getClient',
  ])(
    'stops on uncertainty at %s without issuing cleanup, replay or enable commands',
    async (stage) => {
      const normal = execute.getMockImplementation()!;
      execute.mockImplementation((command) =>
        command.command === stage
          ? Promise.reject(new BrokerAdminError('MQTT_ADMIN_OUTCOME_UNKNOWN'))
          : normal(command),
      );
      await expect(
        admin.prepare(identityId, manufacturer),
      ).rejects.toMatchObject({ code: 'MQTT_ADMIN_OUTCOME_UNKNOWN' });
      const names = execute.mock.calls.map(([command]) => command.command);
      expect(names.at(-1)).toBe(stage);
      expect(names.filter((name) => name === stage)).toHaveLength(1);
      expect(names).not.toContain('enableClient');
      expect(names).not.toContain('deleteClient');
      if (['createRole', 'createClient', 'disableClient'].includes(stage))
        expect(names).not.toContain('setClientPassword');
    },
  );

  it('does not return a password when the final observation is enabled', async () => {
    delete client.disabled;
    await expect(admin.prepare(identityId, manufacturer)).rejects.toEqual(
      new MqttIdentityPolicyError(),
    );
    expect(
      execute.mock.calls.some(
        ([command]) => command.command === 'enableClient',
      ),
    ).toBe(false);
  });

  it('rechecks deny defaults after creation before returning a password', async () => {
    let defaultsRead = 0;
    const normal = execute.getMockImplementation()!;
    execute.mockImplementation((command) => {
      if (command.command === 'getDefaultACLAccess' && ++defaultsRead === 2)
        return Promise.resolve({
          acls: defaults.acls.map((acl) => ({ ...acl, allow: true })),
        });
      return normal(command);
    });
    await expect(admin.prepare(identityId, manufacturer)).rejects.toMatchObject(
      { code: 'MQTT_ADMIN_UNSAFE_DEFAULT_ACL' },
    );
    expect(execute.mock.calls.at(-1)?.[0].command).toBe('getDefaultACLAccess');
  });

  it.each(['prepare', 'inspect'] as const)(
    '%s validates both identifiers before any command',
    async (method) => {
      await expect(admin[method]('invalid', manufacturer)).rejects.toThrow(
        'MQTT_IDENTITY_ID_INVALID',
      );
      await expect(admin[method](identityId, 'shelly/+')).rejects.toThrow(
        'MQTT_DEVICE_ID_INVALID',
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('reads only expected resources and returns no untrusted broker metadata', async () => {
    role.acls = [...expected.acls].reverse();
    role.textdescription = 'sensitive-role-description';
    client.textdescription = 'sensitive-client-description';
    client.password = 'unexpected-sensitive-field';
    const observed = await admin.inspect(identityId, manufacturer);
    expect(observed).toEqual({ identity: expected, brokerState: 'DISABLED' });
    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      { command: 'getDefaultACLAccess' },
      { command: 'getRole', rolename: expected.roleName },
      { command: 'getClient', username: expected.username },
    ]);
    expect(JSON.stringify(observed)).not.toContain('sensitive');
  });

  it.each([false, undefined])(
    'treats disabled=%s as enabled, never as prepared',
    async (disabled) => {
      if (disabled === undefined) delete client.disabled;
      else client.disabled = disabled;
      expect((await admin.inspect(identityId, manufacturer)).brokerState).toBe(
        'ENABLED',
      );
    },
  );

  it.each([
    ['username', 'another-user'],
    ['clientid', 'another-client'],
    ['clientid', undefined],
    ['disabled', 'true'],
    ['disabled', null],
    ['groups', undefined],
    ['groups', [{ groupname: 'other-group' }]],
    ['roles', undefined],
    ['roles', []],
    ['roles', [{ rolename: expected.roleName, priority: '0' }]],
    ['roles', [{ rolename: expected.roleName, priority: -1 }]],
    ['roles', [{ rolename: 'other-role', priority: 0 }]],
    [
      'roles',
      [
        { rolename: expected.roleName, priority: 0 },
        { rolename: 'extra', priority: 0 },
      ],
    ],
  ])(
    'rejects client metadata mismatch in %s without leaking its value',
    async (field, value) => {
      client[field] = value;
      await expect(admin.inspect(identityId, manufacturer)).rejects.toEqual(
        new MqttIdentityPolicyError(),
      );
    },
  );

  it.each([
    ['rolename', 'other-role'],
    ['acls', undefined],
    ['acls', []],
    ['acls', [...expected.acls, expected.acls[0]]],
    ['acls', expected.acls.map(() => expected.acls[0])],
    ['acls', expected.acls.map((acl) => ({ ...acl, allow: 'true' }))],
    ['acls', expected.acls.map((acl) => ({ ...acl, allow: false }))],
    ['acls', expected.acls.map((acl) => ({ ...acl, priority: '0' }))],
    ['acls', expected.acls.map((acl) => ({ ...acl, priority: 1 }))],
    ['acls', expected.acls.map((acl) => ({ ...acl, topic: '#' }))],
    [
      'acls',
      expected.acls.map((acl) => ({ ...acl, acltype: 'subscribePattern' })),
    ],
    ['acls', expected.acls.map(() => null)],
  ])(
    'rejects role/ACL mismatch in %s without silently repairing broker state',
    async (field, value) => {
      role[field] = value;
      await expect(admin.inspect(identityId, manufacturer)).rejects.toEqual(
        new MqttIdentityPolicyError(),
      );
      expect(
        execute.mock.calls.every(([command]) =>
          command.command.startsWith('get'),
        ),
      ).toBe(true);
    },
  );

  it.each([null, [], {}, { role: null }, { role: [] }])(
    'rejects malformed broker metadata (%j)',
    async (payload) => {
      const normal = execute.getMockImplementation()!;
      execute.mockImplementation((command) =>
        command.command === 'getRole'
          ? Promise.resolve(payload)
          : normal(command),
      );
      await expect(admin.inspect(identityId, manufacturer)).rejects.toEqual(
        new MqttIdentityPolicyError(),
      );
    },
  );

  it.each([null, [], {}, { client: null }, { client: [] }])(
    'rejects malformed client response (%j)',
    async (payload) => {
      const normal = execute.getMockImplementation()!;
      execute.mockImplementation((command) =>
        command.command === 'getClient'
          ? Promise.resolve(payload)
          : normal(command),
      );
      await expect(admin.inspect(identityId, manufacturer)).rejects.toEqual(
        new MqttIdentityPolicyError(),
      );
    },
  );

  it('preserves a rejected read as an error instead of declaring the identity absent or safe', async () => {
    const normal = execute.getMockImplementation()!;
    execute.mockImplementation((command) =>
      command.command === 'getClient'
        ? Promise.reject(new BrokerAdminError('MQTT_ADMIN_REJECTED'))
        : normal(command),
    );
    await expect(admin.inspect(identityId, manufacturer)).rejects.toMatchObject(
      { code: 'MQTT_ADMIN_REJECTED' },
    );
    expect(
      execute.mock.calls.every(([command]) =>
        command.command.startsWith('get'),
      ),
    ).toBe(true);
  });
});
