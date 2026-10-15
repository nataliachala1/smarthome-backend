import { randomBytes } from 'node:crypto';
import { DeviceMqttPolicy, deviceMqttUsername } from './device-mqtt-policy';
import {
  BrokerAdminTransport,
  BrokerAdminError,
} from './mosquitto-admin.transport';

/** Internal adapter only. Pairing authorization, persistent identity reservation
 * and reconciliation must wrap these operations before exposing any HTTP flow.
 */
export class MosquittoDeviceIdentityAdmin {
  constructor(
    private readonly transport: BrokerAdminTransport,
    private readonly policy: DeviceMqttPolicy,
  ) {}

  async provision(identityId: string, manufacturerDeviceId: string) {
    const identity = this.policy.device(identityId, manufacturerDeviceId);
    await this.assertDenyDefaults();
    // Roles have no credentials. If creation fails, do not modify an existing
    // role/client or broaden permissions to make a retry appear successful.
    await this.transport.execute({
      command: 'createRole',
      rolename: identity.roleName,
      acls: identity.acls,
    });
    const password = randomBytes(32).toString('base64url');
    await this.transport.execute({
      command: 'createClient',
      username: identity.username,
      clientid: identity.clientId,
      password,
      roles: [{ rolename: identity.roleName, priority: 0 }],
    });
    return { identity, password };
  }

  async revoke(identityId: string): Promise<void> {
    await this.transport.execute({
      command: 'disableClient',
      username: deviceMqttUsername(identityId),
    });
  }

  async rotate(identityId: string): Promise<{ password: string }> {
    const username = deviceMqttUsername(identityId);
    await this.assertDenyDefaults();
    await this.transport.execute({ command: 'disableClient', username });
    const password = randomBytes(32).toString('base64url');
    await this.transport.execute({
      command: 'setClientPassword',
      username,
      password,
    });
    await this.transport.execute({ command: 'enableClient', username });
    return { password };
  }

  private async assertDenyDefaults(): Promise<void> {
    const data = await this.transport.execute({
      command: 'getDefaultACLAccess',
    });
    if (
      !data ||
      typeof data !== 'object' ||
      !('acls' in data) ||
      !Array.isArray(data.acls)
    ) {
      throw new BrokerAdminError('MQTT_ADMIN_UNSAFE_DEFAULT_ACL');
    }
    for (const acltype of [
      'publishClientSend',
      'publishClientReceive',
      'subscribe',
    ]) {
      const matches: unknown[] = data.acls.filter(
        (acl: unknown) =>
          acl !== null &&
          typeof acl === 'object' &&
          'acltype' in acl &&
          acl.acltype === acltype,
      );
      const acl = matches[0];
      if (
        matches.length !== 1 ||
        !acl ||
        typeof acl !== 'object' ||
        !('allow' in acl) ||
        acl.allow !== false
      ) {
        throw new BrokerAdminError('MQTT_ADMIN_UNSAFE_DEFAULT_ACL');
      }
    }
  }
}
