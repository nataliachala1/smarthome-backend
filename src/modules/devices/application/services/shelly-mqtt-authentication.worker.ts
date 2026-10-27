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

/** Respuesta SQL026, obtenida SOLO con el login MQTT RPC dedicado. */
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

/** SQL029: usa OTRO login sin privilegios de SQL026 o SQL027. */
export interface SqlMqttAuthenticatedConfirmationPort {
  confirm(operationId: string, rpcId: string, binding: ReservedBrokerBinding): Promise<void>;
}

export interface AuthMqttChallengeTransport {
  exchange(challenge: ShellyRpcChallenge): Promise<ShellyRpcMessage>;
}

/**
 * NUNCA registrar directamente como endpoint HTTP. Solo puede ejecutar
 * un coordinador que autorizó OWNER+sesión+token y solicitó la activación.
 * La BD no observa el broker; el worker
 * demuestra el challenge y persistente SQL026/SQL029.
 */
export class ShellyMqttAuthenticationWorker {
  constructor(
    private readonly challenges: SqlMqttRpcChallengePort,
    private readonly auth: SqlMqttAuthenticatedConfirmationPort,
    private readonly broker: Pick<MqttDeviceIdentityProvider, 'inspectIdentity'>,
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

    // SQL026 valida OWNER, vigencia, estado AWAITING_AUTH, no-revocacion,
    // historial de reintentos y emite un RPC id no elegido por HTTP.
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

    // Mantener el MISMO rpc_id que entrego SQL026. 50414 usaba un UUID
    // aleatorio separado y por eso NO podia confirmar SQL026 de forma real.
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
    // No reintentos automáticos: un timeout puede significar respuesta tardía.
    const response = await this.mqttTransport.exchange(challenge);
    if (!matchesShellyRpcChallenge(challenge, response) || Date.now() > expiresAtMs) {
      throw new Error('MQTT_AUTH_RPC_NOT_VERIFIED');
    }
    const after = await this.broker.inspectIdentity(binding.username);
    if (!matchesBrokerIdentityConnection(after, binding) || Date.now() > expiresAtMs) {
      throw new Error('MQTT_AUTH_BROKER_UNCERTAIN');
    }

    // DOS transacciones SQL separadas por credenciales de mínimo privilegio.
    // Un timeout al consumir o confirmar NO implica fallo seguro: no repetir
    // sin un worker de reconciliacion que lea estado durable.
    await this.challenges.consume(operationId, issued.rpcId);
    await this.auth.confirm(operationId, issued.rpcId, binding);
    return { phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED' };
  }
}
