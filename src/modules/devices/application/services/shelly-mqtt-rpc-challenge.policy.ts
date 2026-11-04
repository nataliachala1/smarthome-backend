import { randomUUID } from 'node:crypto';
import type { ShellyMqttAclPlan } from './shelly-mqtt-acl.policy';
import type { MqttBrokerIdentitySnapshot } from '../../domain/services/mqtt-device-identity-provider';

const MODEL = 'S4SW-001P16EU';
const CHALLENGE_TTL_MS = 15_000;
const MAX_FRAME_BYTES = 8192;

export interface ShellyRpcChallenge {
  readonly manufacturerDeviceId: string;
  readonly requestTopic: string;
  readonly responseTopic: string;
  readonly source: string;
  readonly rpcId: string;
  readonly payload: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export interface ShellyRpcMessage {
  readonly topic: string;
  readonly payload: Buffer | string;
  readonly retain: boolean;
  readonly receivedAtMs: number;
}

export interface ReservedBrokerBinding {
  readonly username: string;
  readonly clientId: string;
  readonly roleName: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>) : null;
}

/**
 * La respuesta Shelly a una llamada MQTT se publica en <src>/rpc.
 * Usamos <scope>/events como src para que la respuesta vuelva al tópico
 * <scope>/events/rpc, ya permitido por la ACL individual existente.
 * No aceptar topics/control/identificadores proporcionados por el móvil.
 */
export function createShellyRpcChallenge(
  plan: ShellyMqttAclPlan,
  issuedAtMs = Date.now(),
): ShellyRpcChallenge {
  const id = plan.manufacturerDeviceId;
  const scope = plan.topicScope;
  if (
    !/^shelly[a-z0-9_-]{1,100}$/.test(id) ||
    !(scope === id || scope.endsWith(`/devices/${id}`)) ||
    !/^[A-Za-z0-9_.:-]+(?:\/[A-Za-z0-9_.:-]+)*$/.test(scope) ||
    !Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0
  ) {
    throw new Error('SHELLY_RPC_PLAN_INVALID');
  }

  const requestTopic = `${scope}/rpc`;
  const responseTopic = `${scope}/events/rpc`;
  const responseAllowed = plan.acls.some(
    (acl) => acl.type === 'publishClientSend' && acl.topic === responseTopic,
  );
  const receiveAllowed = plan.acls.some(
    (acl) => acl.type === 'subscribeLiteral' && acl.topic === requestTopic,
  );
  if (!responseAllowed || !receiveAllowed) {
    throw new Error('SHELLY_RPC_REQUIRED_ACL_MISSING');
  }

  const rpcId = randomUUID();
  const source = `${scope}/events`;
  return {
    manufacturerDeviceId: id,
    requestTopic,
    responseTopic,
    source,
    rpcId,
    payload: JSON.stringify({ id: rpcId, src: source, method: 'Shelly.GetDeviceInfo' }),
    issuedAtMs,
    expiresAtMs: issuedAtMs + CHALLENGE_TTL_MS,
  };
}

/**
 * Verificación puramente estructural de un candidato de respuesta RPC.
 * No demuestra, por sí sola, autoría criptográfica, posesión física ni
 * que el emisor MQTT fue la conexión observada en getClient.
 * El coordinador debe consumir el desafío una sola vez y correlacionar
 * un getClient fresco dentro del lease vigente, ANTES de cambiar estados.
 */
export function matchesShellyRpcChallenge(
  challenge: ShellyRpcChallenge,
  message: ShellyRpcMessage,
): boolean {
  if (
    message.topic !== challenge.responseTopic ||
    message.retain !== false ||
    !Number.isFinite(message.receivedAtMs) ||
    message.receivedAtMs < challenge.issuedAtMs ||
    message.receivedAtMs > challenge.expiresAtMs
  ) return false;

  let raw: string;
  if (typeof message.payload === 'string') {
    if (Buffer.byteLength(message.payload, 'utf8') > MAX_FRAME_BYTES) return false;
    raw = message.payload;
  } else if (Buffer.isBuffer(message.payload)) {
    if (message.payload.length > MAX_FRAME_BYTES) return false;
    raw = message.payload.toString('utf8');
  } else return false;

  let body: Record<string, unknown> | null;
  try {
    body = asRecord(JSON.parse(raw));
  } catch {
    return false;
  }
  if (
    !body ||
    body.id !== challenge.rpcId ||
    body.src !== challenge.manufacturerDeviceId ||
    body.dst !== challenge.source ||
    body.error !== undefined ||
    body.method !== undefined ||
    body.params !== undefined
  ) return false;

  const result = asRecord(body.result);
  return Boolean(
    result &&
    result.id === challenge.manufacturerDeviceId &&
    result.model === MODEL &&
    result.gen === 4,
  );
}

/**
 * Comprobación SEPARADA de configuración y conexiones del broker.
 * En Mosquitto 2.1+ getClient informa connections. No prueba que una
 * respuesta RPC haya sido enviada por una conexión específica.
 */
export function matchesBrokerIdentityConnection(
  snapshot: MqttBrokerIdentitySnapshot | null,
  binding: ReservedBrokerBinding,
): boolean {
  return Boolean(
    snapshot &&
    snapshot.username === binding.username &&
    snapshot.clientId === binding.clientId &&
    snapshot.disabled === false &&
    snapshot.roleNames.length === 1 &&
    snapshot.roleNames[0] === binding.roleName &&
    typeof snapshot.authenticatedConnectionCount === 'number' &&
    Number.isInteger(snapshot.authenticatedConnectionCount) &&
    snapshot.authenticatedConnectionCount > 0,
  );
}
