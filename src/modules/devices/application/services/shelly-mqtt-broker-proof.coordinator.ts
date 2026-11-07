import {
  createShellyRpcChallenge,
  matchesBrokerIdentityConnection,
  matchesShellyRpcChallenge,
  type ShellyRpcChallenge,
  type ShellyRpcMessage,
  type ReservedBrokerBinding,
} from './shelly-mqtt-rpc-challenge.policy';
import type { ShellyMqttAclPlan } from './shelly-mqtt-acl.policy';
import type { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';

export interface MqttRpcChallengeTransport {
  /** Subscribes to the response BEFORE publishing the request. Does not retry. */
  exchange(challenge: ShellyRpcChallenge): Promise<ShellyRpcMessage>;
}

/**
 * Observation proof; it does NOT authorize HTTP or change SQL or sessions.
 * The calling worker must verify the reservation, the current lease and that the
 * device's exclusive ACLs prevent publications from other MQTT principals.
 * The CONNECTED state requires a new SQL transition, fenced
 * by a token and bound to the identity and the authorized session.
 */
export class ShellyMqttBrokerProofCoordinator {
  constructor(
    private readonly identities: Pick<MqttDeviceIdentityProvider, 'inspectIdentity'>,
    private readonly transport: MqttRpcChallengeTransport,
  ) {}

  async observe(input: {
    readonly plan: ShellyMqttAclPlan;
    readonly binding: ReservedBrokerBinding;
  }): Promise<{ readonly phase: 'MQTT_CHALLENGE_MATCHED_UNPERSISTED'; readonly mqttObserved: true }> {
    const { plan, binding } = input;
    if (!plan || !binding || !/^[A-Za-z0-9_-]{1,128}$/.test(binding.username) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(binding.clientId) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(binding.roleName)) {
      throw new Error('SHELLY_MQTT_PROOF_BINDING_INVALID');
    }
    // getClient() must confirm an enabled AND connected client. The existence
    // of a prepared/disabled identity is not enough.
    const before = await this.identities.inspectIdentity(binding.username);
    if (!matchesBrokerIdentityConnection(before, binding)) {
      throw new Error('SHELLY_MQTT_PROOF_BROKER_NOT_AUTHENTICATED');
    }
    const challenge = createShellyRpcChallenge(plan);
    const message = await this.transport.exchange(challenge);
    if (!matchesShellyRpcChallenge(challenge, message) || Date.now() > challenge.expiresAtMs) {
      throw new Error('SHELLY_MQTT_PROOF_RPC_UNVERIFIED');
    }
    // Fresh observation AFTER the response; time and correlation
    // are verified again, without assuming the MQTT author from the response alone.
    const after = await this.identities.inspectIdentity(binding.username);
    if (!matchesBrokerIdentityConnection(after, binding) || Date.now() > challenge.expiresAtMs) {
      throw new Error('SHELLY_MQTT_PROOF_BROKER_UNCERTAIN');
    }
    // Never return the password, broker admin, nonce/RPC ID or credentials.
    return { phase: 'MQTT_CHALLENGE_MATCHED_UNPERSISTED', mqttObserved: true };
  }
}
