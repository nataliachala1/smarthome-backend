import type { MqttRevocationClaim, MqttRevocationEvidence } from '../../application/services/mqtt-revocation.worker';
import type {
  MqttBrokerIdentitySnapshot,
  MqttDeviceIdentityProvider,
} from '../../domain/services/mqtt-device-identity-provider';

/** Claim-aware adapter. The SQL lease binds every broker action to the exact
 * per-device identity reserved by pairing or the legacy identity registry. */
export class ShellyMqttRevocationBroker {
  constructor(private readonly identities: MqttDeviceIdentityProvider) {}

  async revokeClaim(claim: MqttRevocationClaim): Promise<MqttRevocationEvidence> {
    if (!claim.username || !/^[A-Za-z0-9_-]{1,128}$/.test(claim.username) ||
        ((claim.clientId == null) !== (claim.roleName == null)) ||
        (claim.clientId != null && !/^[A-Za-z0-9_-]{1,128}$/.test(claim.clientId)) ||
        (claim.roleName != null && !/^[A-Za-z0-9_-]{1,128}$/.test(claim.roleName))) {
      throw new Error('MQTT_REVOCATION_BINDING_INVALID');
    }

    const before = await this.identities.inspectIdentity(claim.username);
    if (!before) return 'IDENTITY_ABSENT';
    this.assertBinding(before, claim);

    await this.identities.disableIdentity(claim.username);

    const after = await this.identities.inspectIdentity(claim.username);
    if (!after) return 'IDENTITY_ABSENT';
    this.assertBinding(after, claim);
    if (!after.disabled || after.authenticatedConnectionCount !== 0) {
      throw new Error('MQTT_REVOCATION_OUTCOME_UNVERIFIED');
    }
    return 'DISABLED_NO_CONNECTIONS';
  }

  private assertBinding(
    snapshot: MqttBrokerIdentitySnapshot,
    claim: MqttRevocationClaim,
  ): void {
    if (snapshot.username !== claim.username ||
        (claim.clientId != null && snapshot.clientId !== claim.clientId) ||
        (claim.roleName != null &&
          (snapshot.roleNames.length !== 1 || snapshot.roleNames[0] !== claim.roleName)) ||
        (claim.clientId == null && !snapshot.clientId) ||
        (claim.roleName == null && snapshot.roleNames.length !== 1)) {
      throw new Error('MQTT_REVOCATION_BINDING_MISMATCH');
    }
  }
}
