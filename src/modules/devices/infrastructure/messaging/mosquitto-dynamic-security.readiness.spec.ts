// Pure unit tests: every Dynamic Security response is mocked.
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { MosquittoDynamicSecurityProvider } from './mosquitto-dynamic-security.provider';

const adminUsername = 'dynsec-admin';
const defaults = ['publishClientSend', 'publishClientReceive', 'subscribe', 'unsubscribe'];

function providerWith(responseOverrides: Record<string, unknown> = {}) {
  const provider = new MosquittoDynamicSecurityProvider({
    get: (name: string) => name === 'MQTT_DYNSEC_ADMIN_USERNAME' ? adminUsername : undefined,
  } as never);
  const command = jest.spyOn(provider as unknown as {
    command: (name: string, parameters?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }, 'command').mockImplementation((name, parameters) => {
    if (name === 'getDefaultACLAccess') {
      return Promise.resolve({ acls: defaults.map((acltype) => ({
        acltype,
        allow: responseOverrides[`default:${acltype}`] ?? false,
      })) });
    }
    if (name === 'getClient') {
      return Promise.resolve({ client: {
        username: parameters?.username,
        connections: Object.prototype.hasOwnProperty.call(responseOverrides, 'connections')
          ? responseOverrides.connections
          : [{ address: '127.0.0.1' }],
      } });
    }
    return Promise.reject(new Error('UNEXPECTED_DYNSEC_COMMAND'));
  });
  return { provider, command };
}

describe('Mosquitto Dynamic Security runtime readiness', () => {
  it('requires deny defaults for publish, delivery, subscribe, and unsubscribe', async () => {
    const { provider, command } = providerWith();
    await expect(provider.verifyBrokerPrerequisites()).resolves.toBeUndefined();
    expect(command.mock.calls.map(([name]) => name)).toEqual([
      'getDefaultACLAccess', 'getClient',
    ]);
  });

  it.each(['publishClientSend', 'publishClientReceive', 'subscribe', 'unsubscribe'])(
    'fails closed when the broker default for %s is not deny', async (acltype) => {
      const { provider } = providerWith({ [`default:${acltype}`]: true });
      await expect(provider.verifyBrokerPrerequisites()).rejects.toMatchObject({
        response: { code: 'MQTT_DYNSEC_DEFAULT_DENY_NOT_CONFIRMED' },
      });
    },
  );

  it.each([
    undefined,
    [],
    [{ address: '' }],
    [null],
  ])('fails closed when getClient cannot prove an active admin connection (%j)', async (connections) => {
    const { provider } = providerWith({ connections });
    await expect(provider.verifyBrokerPrerequisites()).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_CONNECTION_OBSERVATION_UNSUPPORTED' },
    });
  });

  it('does not interpret the Mosquitto 2.0 response shape as a disconnected identity', async () => {
    const { provider, command } = providerWith({ connections: undefined });
    command.mockResolvedValue({ client: {
      username: 'device-user', clientid: 'device-client', disabled: false,
      roles: [], connections: undefined,
    } });

    await expect(provider.inspectIdentity('device-user')).resolves.toMatchObject({
      authenticatedConnectionCount: null,
    });
  });
});
