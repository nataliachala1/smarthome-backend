// Solo mocks: NO conecta ni modifica Mosquitto real.
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { MosquittoDynamicSecurityProvider } from './mosquitto-dynamic-security.provider';
import type { VerifyPreparedMqttIdentityInput } from '../../domain/services/mqtt-device-identity-provider';

const scope = 'shelly1pmg4-testdevice001';
const expected: VerifyPreparedMqttIdentityInput = {
  username: 'shd_lab_test_001',
  clientId: 'shd-lab-test-001',
  roleName: 'role_shd_lab_test_001',
  topicScope: scope,
  acls: [
    { type: 'publishClientSend', topic: `${scope}/status/switch:0`, priority: 10 },
    { type: 'publishClientSend', topic: `${scope}/events/rpc`, priority: 10 },
    { type: 'subscribeLiteral', topic: `${scope}/rpc`, priority: 10 },
    { type: 'publishClientReceive', topic: `${scope}/rpc`, priority: 10 },
    { type: 'unsubscribeLiteral', topic: `${scope}/rpc`, priority: 10 },
  ],
};

function harness(change?: {
  client?: Record<string, unknown>;
  acl?: Record<string, unknown>;
  extraAcl?: Record<string, unknown>;
}) {
  const provider = new MosquittoDynamicSecurityProvider({ get: () => undefined } as never);
  const client = {
    username: expected.username,
    clientid: expected.clientId,
    disabled: true,
    roles: [{ rolename: expected.roleName, priority: 10 }],
    groups: [],
    ...change?.client,
  };
  const acls = expected.acls.map((item) => ({
    acltype: item.type,
    topic: item.topic,
    priority: item.priority,
    allow: true,
  }));
  if (change?.acl) acls[0] = { ...acls[0], ...change.acl };
  if (change?.extraAcl) acls.push(change.extraAcl as typeof acls[number]);
  const command = jest.spyOn(provider as unknown as {
    command: (name: string) => Promise<Record<string, unknown>>;
  }, 'command').mockImplementation((name) => {
    if (name === 'getClient') return Promise.resolve({ client });
    if (name === 'getRole') return Promise.resolve({ role: { rolename: expected.roleName, acls } });
    return Promise.reject(new Error('UNEXPECTED_BROKER_COMMAND'));
  });
  return { provider, command };
}

describe('Mosquitto exact prepared identity verification / no network', () => {
  it('requires a disabled identity, no groups, only intended role and exactly 5 ACLs', async () => {
    const { provider, command } = harness();
    await expect(provider.verifyPreparedDisabled(expected)).resolves.toBeUndefined();
    expect(command).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ disabled: false }, 'MQTT_DYNSEC_PREPARE_NOT_CONFIRMED'],
    [{ clientid: 'other-client' }, 'MQTT_DYNSEC_PREPARE_NOT_CONFIRMED'],
    [{ groups: [{ groupname: 'other-group', priority: 1 }] }, 'MQTT_DYNSEC_PREPARE_NOT_CONFIRMED'],
    [{ roles: [{ rolename: 'other-role', priority: 10 }] }, 'MQTT_DYNSEC_PREPARE_NOT_CONFIRMED'],
    [{ roles: [{ rolename: expected.roleName, priority: 10 }, { rolename: 'another', priority: 5 }] }, 'MQTT_DYNSEC_PREPARE_NOT_CONFIRMED'],
  ] as const)('rejects invalid client state %j', async (client, code) => {
    const { provider } = harness({ client: client });
    await expect(provider.verifyPreparedDisabled(expected)).rejects.toMatchObject({ response: { code } });
  });

  it.each([
    [{ allow: false }, 'denied ACL'],
    [{ topic: `${scope}/events/rpc` }, 'wrong ACL topic'],
    [{ priority: 100 }, 'changed priority'],
    [{ acltype: 'subscribePattern' }, 'wildcard-capable role'],
  ] as const)('rejects %s (%s)', async (acl) => {
    const { provider } = harness({ acl: acl });
    await expect(provider.verifyPreparedDisabled(expected)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_ACLS_NOT_CONFIRMED' },
    });
  });

  it('rejects additional ACLs, including permissions on another device', async () => {
    const { provider } = harness({ extraAcl: {
      acltype: 'publishClientSend', topic: 'other-device/#', priority: 10, allow: true,
    } });
    await expect(provider.verifyPreparedDisabled(expected)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_ACLS_NOT_CONFIRMED' },
    });
  });

  it('does not accept 4 ACLs as an official Shelly plan', async () => {
    const { provider, command } = harness();
    await expect(provider.verifyPreparedDisabled({
      ...expected, acls: expected.acls.slice(0, 4),
    })).rejects.toMatchObject({ response: { code: 'MQTT_DYNSEC_UNSAFE_ACL' } });
    expect(command).not.toHaveBeenCalled();
  });
});
