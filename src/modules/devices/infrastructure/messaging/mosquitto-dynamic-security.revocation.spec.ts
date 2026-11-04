// Mocks only. This suite never connects to a broker.
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { MosquittoDynamicSecurityProvider } from './mosquitto-dynamic-security.provider';

const username = 'lab_revocation_device';
const activeClient = {
  username,
  clientid: 'lab-revocation-device',
  disabled: false,
  roles: [{ rolename: 'role_lab_revocation_device', priority: 10 }],
  connections: [{ address: '127.0.0.1:50000' }],
};

function harness(after: Record<string, unknown>, intermediate?: Record<string, unknown>) {
  const provider = new MosquittoDynamicSecurityProvider({
    get: () => undefined,
  } as never);
  let getClientCalls = 0;
  const command = jest.spyOn(provider as unknown as {
    command: (name: string, parameters?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }, 'command').mockImplementation((name) => {
    if (name === 'getClient') {
      const callIndex = getClientCalls++;
      const client = callIndex === 0
        ? activeClient
        : callIndex === 1 && intermediate
          ? intermediate
          : after;
      return Promise.resolve({ client });
    }
    if (name === 'disableClient') return Promise.resolve({});
    return Promise.reject(new Error('UNEXPECTED_BROKER_COMMAND'));
  });
  return { provider, command };
}

describe('Mosquitto DynSec revocation connection evidence / no network', () => {
  it('confirms disabled state and zero authenticated connections after kicking a client', async () => {
    const { provider, command } = harness({
      ...activeClient,
      disabled: true,
      connections: [],
    });

    await expect(provider.disableIdentity(username)).resolves.toBeUndefined();
    expect(command).toHaveBeenCalledWith('disableClient', { username });
  });

  it('waits for the broker to close the last connection before confirming', async () => {
    const { provider, command } = harness(
      { ...activeClient, disabled: true, connections: [] },
      { ...activeClient, disabled: true },
    );

    await expect(provider.disableIdentity(username)).resolves.toBeUndefined();
    expect(command.mock.calls.filter(([name]) => name === 'getClient')).toHaveLength(3);
  });

  it('does not confirm revocation while any authenticated connection remains', async () => {
    const { provider } = harness({
      ...activeClient,
      disabled: true,
      connections: [{ address: '127.0.0.1:50000' }],
    });

    await expect(provider.disableIdentity(username)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_DISABLE_NOT_CONFIRMED' },
    });
  });

  it('does not interpret missing connection evidence as zero', async () => {
    const { provider } = harness({
      ...activeClient,
      disabled: true,
      connections: undefined,
    });

    await expect(provider.disableIdentity(username)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_DISABLE_NOT_CONFIRMED' },
    });
  });

  it('rechecks a client that was already disabled', async () => {
    const { provider, command } = harness({
      ...activeClient,
      disabled: true,
      connections: [],
    });
    command.mockImplementation(async (name) => {
      if (name === 'getClient') {
        return { client: { ...activeClient, disabled: true, connections: [] } };
      }
      return Promise.reject(new Error('UNEXPECTED_BROKER_COMMAND'));
    });

    await expect(provider.disableIdentity(username)).resolves.toBeUndefined();
    expect(command).toHaveBeenCalledTimes(2);
  });
});
