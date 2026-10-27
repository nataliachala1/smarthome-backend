// Regresiones sin red basadas en la estructura JSON real de DynSec.
// No utilizar ni requerir credenciales del broker.
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { MosquittoDynamicSecurityProvider } from './mosquitto-dynamic-security.provider';
import type { VerifyPreparedMqttIdentityInput } from '../../domain/services/mqtt-device-identity-provider';

const scope = 'shelly1pmg4-testdevice503152';
const expected: VerifyPreparedMqttIdentityInput = {
  username: 'lab_503152_device',
  clientId: 'lab-503152-device',
  roleName: 'role_lab_503152_device',
  topicScope: scope,
  acls: [
    { type: 'publishClientSend', topic: `${scope}/status/switch:0`, priority: 10 },
    { type: 'publishClientSend', topic: `${scope}/events/rpc`, priority: 10 },
    { type: 'subscribeLiteral', topic: `${scope}/rpc`, priority: 10 },
    { type: 'publishClientReceive', topic: `${scope}/rpc`, priority: 10 },
    { type: 'unsubscribeLiteral', topic: `${scope}/rpc`, priority: 10 },
  ],
};

type Overrides = { roleName?: string | null; dropAcl?: boolean; extraAcl?: boolean };
function prepare(overrides: Overrides = {}) {
  const provider = new MosquittoDynamicSecurityProvider({ get: () => undefined } as never);
  const acls: Array<Record<string, unknown>> = expected.acls.map((a) => ({
    acltype: a.type,
    topic: a.topic,
    priority: a.priority,
    allow: true,
  }));
  if (overrides.dropAcl) acls.pop();
  if (overrides.extraAcl) acls.push({
    acltype: 'publishClientSend', topic: 'otro-dispositivo/#', priority: 10, allow: true,
  });
  const role: Record<string, unknown> = { acls };
  if (overrides.roleName !== undefined && overrides.roleName !== null) {
    role.rolename = overrides.roleName;
  }
  const command = jest.spyOn(provider as unknown as {
    command: (name: string) => Promise<Record<string, unknown>>;
  }, 'command').mockImplementation((name) => {
    if (name === 'getClient') return Promise.resolve({
      client: {
        username: expected.username,
        clientid: expected.clientId,
        disabled: true,
        roles: [{ rolename: expected.roleName, priority: 10 }],
        groups: [],
      },
    });
    if (name === 'getRole') return Promise.resolve({ role });
    return Promise.reject(new Error('UNEXPECTED_DYNSEC_COMMAND'));
  });
  return { provider, command };
}

describe('DynSec getRole omite rolename: regresion observada en broker real', () => {
  it('acepta rol sin rolename solo cuando tiene exactamente las cinco ACL correctas', async () => {
    const { provider, command } = prepare();
    await expect(provider.verifyPreparedDisabled(expected)).resolves.toBeUndefined();
    expect(command).toHaveBeenCalledTimes(2);
    expect(command).toHaveBeenCalledWith('getRole', { rolename: expected.roleName });
  });

  it('rechaza nombre distinto cuando el broker si proporciona rolename', async () => {
    const { provider } = prepare({ roleName: 'otro_rol' });
    await expect(provider.verifyPreparedDisabled(expected)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_ACLS_NOT_CONFIRMED' },
    });
  });

  it('rechaza rol sin rolename si le falta una ACL', async () => {
    const { provider } = prepare({ dropAcl: true });
    await expect(provider.verifyPreparedDisabled(expected)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_ACLS_NOT_CONFIRMED' },
    });
  });

  it('rechaza ACL adicional para otros dispositivos aun sin rolename', async () => {
    const { provider } = prepare({ extraAcl: true });
    await expect(provider.verifyPreparedDisabled(expected)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_ACLS_NOT_CONFIRMED' },
    });
  });
});
