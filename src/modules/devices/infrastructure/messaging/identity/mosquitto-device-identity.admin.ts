import { randomBytes } from 'node:crypto';
import { DeviceMqttPolicy, deviceMqttUsername } from './device-mqtt-policy';
import {
  BrokerAdminTransport,
  BrokerAdminError,
} from './mosquitto-admin.transport';
import {
  checkedMqttIdentitySnapshot,
  MqttIdentityPolicyError,
} from './mqtt-identity-snapshot';

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

  /** Internal preparation only: the returned credential is installed AFTER a
   * confirmed disable and is never enabled here. Reservation, authorization,
   * durable compensation and an activation coordinator are still required.
   */
  async prepare(identityId: string, manufacturerDeviceId: string) {
    // Mosquitto 2.0.22 createClient does not honor a disabled creation flag.
    // Its temporary random password is discarded and never delivered.
    const { identity } = await this.provision(identityId, manufacturerDeviceId);
    await this.revoke(identityId);
    const password = randomBytes(32).toString('base64url');
    await this.transport.execute({
      command: 'setClientPassword',
      username: identity.username,
      password,
    });
    const observed = await this.inspect(identityId, manufacturerDeviceId);
    if (observed.brokerState !== 'DISABLED')
      throw new MqttIdentityPolicyError();
    return { identity, password, brokerState: 'DISABLED' as const };
  }

  /** Read-only inspection. Errors do not mean the identity is absent; a
   * rejected getClient/getRole requires reconciliation, never auto-adoption.
   */
  async inspect(identityId: string, manufacturerDeviceId: string) {
    const identity = this.policy.device(identityId, manufacturerDeviceId);
    await this.assertDenyDefaults();
    const role = await this.transport.execute({
      command: 'getRole',
      rolename: identity.roleName,
    });
    // Read the disabled state last, after defaults and the role definition.
    const client = await this.transport.execute({
      command: 'getClient',
      username: identity.username,
    });
    return checkedMqttIdentitySnapshot(identity, role, client);
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
