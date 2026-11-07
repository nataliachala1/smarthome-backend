import type { MqttPrivilegedReservationPort } from '../../application/services/shelly-mqtt-reservation.coordinator';

/**
 * SQL access port. It must receive a PostgreSQL pool EXCLUSIVE to the
 * specialized LOGIN role that inherits smarthome_mqtt_registrar.
 * Do not use PrismaRlsService, DATABASE_URL or the smarthome_app credentials.
 *
 * Structurally compatible with pg.Pool.query, without opening connections here.
 */
export interface MqttRegistrarQueryClient {
  query(sql: string, parameters: unknown[]): Promise<{ rows: unknown[] }>;
}

type ReservationRow = {
  operationId: string;
  identityId: string;
  username: string;
  clientId: string;
  roleName: string;
  reservedTopicScope: string;
};

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOPIC_SCOPE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

/**
 * Runs ONLY the 022 reservation function; it does not provision MQTT or change
 * the state of a session or an identity.
 *
 * The caller must authorize OWNER+token and derive the scope from the backend
 * contract. The SQL checks validity, state and physical ID conflicts.
 * Do not register this adapter in DevicesModule until an independent SQL role
 * is configured and migrations 022/023 are confirmed on the target environment.
 */
export class PgMqttReservationPort implements MqttPrivilegedReservationPort {
  constructor(private readonly registrarPool: MqttRegistrarQueryClient) {}

  async reserve(sessionId: string, derivedTopicScope: string, actorId: string, tokenProofHash: string): Promise<ReservationRow> {
    if (!UUID_V4.test(sessionId)) {
      throw new Error('MQTT_REGISTRAR_SESSION_ID_INVALID');
    }
    if (
      !derivedTopicScope ||
      derivedTopicScope.length > 256 ||
      !TOPIC_SCOPE.test(derivedTopicScope) ||
      !derivedTopicScope.split('/').at(-1)?.startsWith('shelly')
    ) {
      throw new Error('MQTT_REGISTRAR_TOPIC_SCOPE_INVALID');
    }

    if (!UUID_V4.test(actorId) || !/^[0-9a-f]{64}$/.test(tokenProofHash)) {
      throw new Error('MQTT_REGISTRAR_AUTH_PROOF_INVALID');
    }

    // The only operation with side effects: the SECURITY DEFINER function validates the
    // session and locks the physical identifier before inserting the reservation.
    // Do not interpolate identifiers or values into the SQL statement.
    let rows: unknown[];
    try {
      const result = await this.registrarPool.query(
        `SELECT
          operation_id::text AS "operationId",
          identity_id::text AS "identityId",
          username::text AS "username",
          client_id::text AS "clientId",
          role_name::text AS "roleName",
          reserved_topic_scope::text AS "reservedTopicScope"
        FROM devices.fn_reserve_mqtt_pairing_operation($1::uuid, $2::text, $3::uuid, $4::text)`,
        [sessionId, derivedTopicScope, actorId, tokenProofHash],
      );
      rows = result.rows;
    } catch {
      // Do not expose SQL details, roles, hosts or PostgreSQL messages.
      throw new Error('MQTT_REGISTRAR_RESERVATION_FAILED');
    }

    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error('MQTT_REGISTRAR_INVALID_RESPONSE');
    }
    const row = rows[0];
    if (!isReservationRow(row) || row.reservedTopicScope !== derivedTopicScope) {
      throw new Error('MQTT_REGISTRAR_INVALID_RESPONSE');
    }

    const suffix = row.identityId.replace(/-/g, '');
    if (
      row.username !== `shd_${suffix}` ||
      row.clientId !== `shd-${suffix}` ||
      row.roleName !== `role_shd_${suffix}`
    ) {
      throw new Error('MQTT_REGISTRAR_INVALID_RESPONSE');
    }
    return row;
  }
}

function isReservationRow(value: unknown): value is ReservationRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.operationId === 'string' && UUID_V4.test(row.operationId) &&
    typeof row.identityId === 'string' && UUID_V4.test(row.identityId) &&
    typeof row.username === 'string' &&
    typeof row.clientId === 'string' &&
    typeof row.roleName === 'string' &&
    typeof row.reservedTopicScope === 'string'
  );
}
