import {
  createShellyRpcChallenge,
  matchesBrokerIdentityConnection,
  matchesShellyRpcChallenge,
  type ReservedBrokerBinding,
  type ShellyRpcChallenge,
  type ShellyRpcMessage,
} from './shelly-mqtt-rpc-challenge.policy';
import { buildShellyMqttAclPlan } from './shelly-mqtt-acl.policy';
import type { MqttTopicContract } from '../../infrastructure/messaging/mqtt-topic-contract';
import type { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_CHALLENGE_MS = 15_000;

/** SQL026 response, obtained ONLY with the dedicated MQTT RPC login. */
export interface SqlIssuedMqttChallenge {
  rpcId: string;
  manufacturerDeviceId: string;
  requestTopic: string;
  responseTopic: string;
  requestSource: string;
  issuedAt: Date | string;
  expiresAt: Date | string;
  brokerUsername: string;
  brokerClientId: string;
  brokerRoleName: string;
}

export interface SqlMqttRpcChallengePort {
  issue(operationId: string): Promise<SqlIssuedMqttChallenge>;
  consume(operationId: string, rpcId: string): Promise<void>;
}

/** SQL029: uses ANOTHER login without SQL026 or SQL027 privileges. */
export interface SqlMqttAuthenticatedConfirmationPort {
  confirm(operationId: string, rpcId: string, binding: ReservedBrokerBinding): Promise<void>;
}

export interface AuthMqttChallengeTransport {
  exchange(challenge: ShellyRpcChallenge): Promise<ShellyRpcMessage>;
}

/**
 * NEVER register it directly as an HTTP endpoint. It can only be run by
 * a coordinator that authorized OWNER+session+token and requested enabling.
 * The DB does not observe the broker; the worker
 * proves the challenge and persists SQL026/SQL029.
 */
export class ShellyMqttAuthenticationWorker {
  constructor(
    private readonly challenges: SqlMqttRpcChallengePort,
    private readonly auth: SqlMqttAuthenticatedConfirmationPort,
    private readonly broker: Pick<
      MqttDeviceIdentityProvider,
      'inspectIdentity' | 'verifyBrokerPrerequisites'
    >,
    private readonly mqttTransport: AuthMqttChallengeTransport,
    private readonly topics: MqttTopicContract,
    private readonly switchId: number,
  ) {}

  async confirm(operationId: string, expectedManufacturerDeviceId: string): Promise<{
    readonly phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED';
  }> {
    if (!UUID.test(operationId) ||
        typeof expectedManufacturerDeviceId !== 'string' ||
        !/^shelly[a-z0-9_-]{1,100}$/.test(expectedManufacturerDeviceId)) {
      throw new Error('MQTT_AUTH_OPERATION_INVALID');
    }

    // No issue a short-lived SQL challenge if the broker has lost its
    // authenticated-connection evidence or default-deny guarantees.
    await this.broker.verifyBrokerPrerequisites();

    // SQL026 validates OWNER, validity, AWAITING_AUTH state, non-revocation,
    // retry history and issues an RPC id not chosen by HTTP.
    const issued = await this.challenges.issue(operationId);
    if (!UUID.test(issued.rpcId) ||
      !NAME.test(issued.brokerUsername) ||
      !NAME.test(issued.brokerClientId) ||
      !NAME.test(issued.brokerRoleName)) {
      throw new Error('MQTT_AUTH_SQL026_REPLY_INVALID');
    }
    if (issued.manufacturerDeviceId !== expectedManufacturerDeviceId) {
      throw new Error('MQTT_AUTH_OPERATION_SESSION_BINDING_MISMATCH');
    }
    const plan = buildShellyMqttAclPlan(
      this.topics, issued.manufacturerDeviceId, this.switchId,
    );
    const binding: ReservedBrokerBinding = {
      username: issued.brokerUsername,
      clientId: issued.brokerClientId,
      roleName: issued.brokerRoleName,
    };
    const issuedAtMs = new Date(issued.issuedAt).getTime();
    const expiresAtMs = new Date(issued.expiresAt).getTime();
    const now = Date.now();
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) ||
        expiresAtMs - issuedAtMs !== MAX_CHALLENGE_MS ||
        issuedAtMs > now + 1000 || expiresAtMs <= now ||
        issued.requestTopic !== `${plan.topicScope}/rpc` ||
        issued.responseTopic !== `${plan.topicScope}/events/rpc` ||
        issued.requestSource !== `${plan.topicScope}/events`) {
      throw new Error('MQTT_AUTH_SQL026_SCOPE_OR_WINDOW_INVALID');
    }

    // Keep the SAME rpc_id that SQL026 returned. 50414 used a separate random
    // UUID and therefore could NOT really confirm SQL026.
    const template = createShellyRpcChallenge(plan, issuedAtMs);
    const challenge: ShellyRpcChallenge = {
      ...template,
      rpcId: issued.rpcId,
      payload: JSON.stringify({
        id: issued.rpcId, src: issued.requestSource,
        method: 'Shelly.GetDeviceInfo',
      }),
    };
    const before = await this.broker.inspectIdentity(binding.username);
    if (!matchesBrokerIdentityConnection(before, binding)) {
      throw new Error('MQTT_AUTH_BROKER_NOT_AUTHENTICATED');
    }
    // No automatic retries: a timeout may mean a late response.
    const response = await this.mqttTransport.exchange(challenge);
    if (!matchesShellyRpcChallenge(challenge, response) || Date.now() > expiresAtMs) {
      throw new Error('MQTT_AUTH_RPC_NOT_VERIFIED');
    }
    const after = await this.broker.inspectIdentity(binding.username);
    if (!matchesBrokerIdentityConnection(after, binding) || Date.now() > expiresAtMs) {
      throw new Error('MQTT_AUTH_BROKER_UNCERTAIN');
    }

    // TWO SQL transactions separated by least-privilege credentials.
    // A timeout while consuming or confirming does NOT imply a safe failure: do not
    // repeat without a reconciliation worker that reads the durable state.
    await this.challenges.consume(operationId, issued.rpcId);
    await this.auth.confirm(operationId, issued.rpcId, binding);
    return { phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED' };
  }
}
