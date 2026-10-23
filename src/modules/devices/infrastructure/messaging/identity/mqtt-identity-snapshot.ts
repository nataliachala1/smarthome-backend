import type { DeviceMqttIdentity } from './device-mqtt-policy';

export class MqttIdentityPolicyError extends Error {
  readonly code = 'MQTT_IDENTITY_POLICY_MISMATCH';

  constructor() {
    super('MQTT_IDENTITY_POLICY_MISMATCH');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate observed metadata; never return broker payloads or adopt its ACLs.
 * This is a snapshot of separate reads, not a lock or proof of possession.
 */
export function checkedMqttIdentitySnapshot(
  expected: DeviceMqttIdentity,
  roleData: unknown,
  clientData: unknown,
): { identity: DeviceMqttIdentity; brokerState: 'ENABLED' | 'DISABLED' } {
  if (!record(roleData) || !record(roleData.role))
    throw new MqttIdentityPolicyError();
  const role = roleData.role;
  if (
    role.rolename !== expected.roleName ||
    !Array.isArray(role.acls) ||
    role.acls.length !== expected.acls.length
  )
    throw new MqttIdentityPolicyError();
  // Match every ACL exactly once. No wildcard, priority/type coercion, missing
  // permission or additional deny/allow rule is silently accepted.
  const remaining = [...expected.acls];
  for (const acl of role.acls as unknown[]) {
    if (!record(acl)) throw new MqttIdentityPolicyError();
    const index = remaining.findIndex(
      (item) =>
        item.acltype === acl.acltype &&
        item.topic === acl.topic &&
        item.allow === acl.allow &&
        item.priority === acl.priority,
    );
    if (index < 0) throw new MqttIdentityPolicyError();
    remaining.splice(index, 1);
  }
  if (!record(clientData) || !record(clientData.client))
    throw new MqttIdentityPolicyError();
  const client = clientData.client;
  if (
    client.username !== expected.username ||
    client.clientid !== expected.clientId ||
    !Array.isArray(client.groups) ||
    client.groups.length !== 0 ||
    !Array.isArray(client.roles) ||
    client.roles.length !== 1 ||
    !record(client.roles[0]) ||
    client.roles[0].rolename !== expected.roleName ||
    client.roles[0].priority !== 0 ||
    (Object.hasOwn(client, 'disabled') && typeof client.disabled !== 'boolean')
  )
    throw new MqttIdentityPolicyError();
  // Mosquitto 2.0.22 omits disabled when false. Missing is never DISABLED.
  return {
    identity: expected,
    brokerState: client.disabled === true ? 'DISABLED' : 'ENABLED',
  };
}
