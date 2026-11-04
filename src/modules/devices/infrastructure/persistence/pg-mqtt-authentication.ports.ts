import type {
  SqlIssuedMqttChallenge,
  SqlMqttRpcChallengePort,
  SqlMqttAuthenticatedConfirmationPort,
} from '../../application/services/shelly-mqtt-authentication.worker';
import type { ReservedBrokerBinding } from '../../application/services/shelly-mqtt-rpc-challenge.policy';

/**
 * Cada cliente se inyecta con una CUENTA LOGIN distinta, verificada por su
 * propia fabrica. NUNCA usar DATABASE_URL, Prisma o la cuenta del broker.
 * Un factory sin comprobacion de roles no es apto para ejecutar estos ports.
 */
export interface IsolatedMqttAuthSqlClient {
  query(sql: string, params: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME = /^[A-Za-z0-9_-]{1,128}$/;

export class PgMqttRpcChallengePort implements SqlMqttRpcChallengePort {
  constructor(private readonly db: IsolatedMqttAuthSqlClient) {}

  async issue(operationId: string): Promise<SqlIssuedMqttChallenge> {
    if (!UUID.test(operationId)) throw new Error('MQTT_RPC_OPERATION_INVALID');
    let rows: unknown[];
    try {
      ({ rows } = await this.db.query(
        `SELECT rpc_id::text AS "rpcId", manufacturer_device_id AS "manufacturerDeviceId",
           request_topic AS "requestTopic", response_topic AS "responseTopic",
           request_source AS "requestSource", issued_at AS "issuedAt",
           expires_at AS "expiresAt", broker_username AS "brokerUsername",
           broker_client_id AS "brokerClientId", broker_role_name AS "brokerRoleName"
         FROM devices.fn_issue_mqtt_rpc_challenge($1::uuid)`,
        [operationId],
      ));
    } catch { throw new Error('MQTT_RPC_ISSUE_OUTCOME_UNCERTAIN'); }
    if (!Array.isArray(rows) || rows.length !== 1 ||
        !rows[0] || typeof rows[0] !== 'object') {
      throw new Error('MQTT_RPC_ISSUE_REPLY_INVALID');
    }
    const r = rows[0] as Record<string, unknown>;
    for (const key of ['rpcId', 'manufacturerDeviceId', 'requestTopic', 'responseTopic',
      'requestSource', 'brokerUsername', 'brokerClientId', 'brokerRoleName']) {
      if (typeof r[key] !== 'string') throw new Error('MQTT_RPC_ISSUE_REPLY_INVALID');
    }
    if (!UUID.test(r.rpcId as string) ||
        !(r.issuedAt instanceof Date || typeof r.issuedAt === 'string') ||
        !(r.expiresAt instanceof Date || typeof r.expiresAt === 'string')) {
      throw new Error('MQTT_RPC_ISSUE_REPLY_INVALID');
    }
    return r as unknown as SqlIssuedMqttChallenge;
  }

  async consume(operationId: string, rpcId: string): Promise<void> {
    if (!UUID.test(operationId) || !UUID.test(rpcId)) {
      throw new Error('MQTT_RPC_CONSUME_ARGUMENTS_INVALID');
    }
    let rows: unknown[];
    try {
      ({ rows } = await this.db.query(
        'SELECT devices.fn_consume_mqtt_rpc_candidate($1::uuid,$2::uuid) AS consumed',
        [operationId, rpcId],
      ));
    } catch { throw new Error('MQTT_RPC_CONSUME_OUTCOME_UNCERTAIN'); }
    if (!Array.isArray(rows) || rows.length !== 1 ||
        !(rows[0] as { consumed?: unknown })?.consumed) {
      throw new Error('MQTT_RPC_CONSUME_NOT_CONFIRMED');
    }
  }
}

export class PgMqttAuthConfirmPort implements SqlMqttAuthenticatedConfirmationPort {
  constructor(private readonly db: IsolatedMqttAuthSqlClient) {}

  async confirm(operationId: string, rpcId: string, binding: ReservedBrokerBinding): Promise<void> {
    if (!UUID.test(operationId) || !UUID.test(rpcId) ||
        !NAME.test(binding.username) || !NAME.test(binding.clientId) ||
        !NAME.test(binding.roleName)) {
      throw new Error('MQTT_AUTH_CONFIRM_ARGUMENTS_INVALID');
    }
    let rows: unknown[];
    try {
      ({ rows } = await this.db.query(
        `SELECT devices.fn_confirm_mqtt_broker_authentication(
          $1::uuid,$2::uuid,$3::text,$4::text,$5::text
         ) AS confirmed`,
        [operationId, rpcId, binding.username, binding.clientId, binding.roleName],
      ));
    } catch { throw new Error('MQTT_AUTH_CONFIRM_OUTCOME_UNCERTAIN'); }
    if (!Array.isArray(rows) || rows.length !== 1 ||
        (rows[0] as { confirmed?: unknown })?.confirmed !== true) {
      throw new Error('MQTT_AUTH_CONFIRM_NOT_CONFIRMED');
    }
  }
}
