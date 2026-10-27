import type {
  MqttPrivilegedReservationPort,
} from '../../application/services/shelly-mqtt-reservation.coordinator';

/**
 * This client MUST be created by a dedicated PostgreSQL gateway authenticated
 * ONLY with smarthome_mqtt_reserver. Never inject Prisma or DATABASE_URL.
 * The adapter does not prove authorization by itself; SQL 022 revalidates the
 * ACTIVE OWNER, session token hash, pairing expiry and manufacturer binding.
 *
 * Not registered in DevicesModule until the separate SQL gateway and worker
 * lifecycle have been implemented, tested, and reviewed.
 */
export interface MqttReservationQueryClient {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_SHA256 = /^[0-9a-f]{64}$/;
const TOPIC_SCOPE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export class PgMqttPrivilegedReservationPort
implements MqttPrivilegedReservationPort {
  constructor(private readonly reserver: MqttReservationQueryClient) {}

  async reserve(
    sessionId: string,
    derivedTopicScope: string,
    actorId: string,
    tokenProofHash: string,
  ): Promise<{
    operationId: string;
    identityId: string;
    username: string;
    clientId: string;
    roleName: string;
    reservedTopicScope: string;
  }> {
    if (
      typeof sessionId !== 'string' || !UUID_V4.test(sessionId) ||
      typeof actorId !== 'string' || !UUID_V4.test(actorId) ||
      typeof tokenProofHash !== 'string' || !TOKEN_SHA256.test(tokenProofHash) ||
      typeof derivedTopicScope !== 'string' ||
      derivedTopicScope.length < 1 || derivedTopicScope.length > 256 ||
      !TOPIC_SCOPE.test(derivedTopicScope)
    ) {
      throw new Error('MQTT_RESERVATION_INPUT_INVALID');
    }

    let rows: unknown[];
    try {
      const result = await this.reserver.query(
        `SELECT operation_id::text AS "operationId",
                identity_id::text AS "identityId",
                username::text AS "username",
                client_id::text AS "clientId",
                role_name::text AS "roleName",
                reserved_topic_scope::text AS "reservedTopicScope"
           FROM devices.fn_reserve_mqtt_pairing_operation(
             $1::uuid, $2::text, $3::uuid, $4::text
           )`,
        [sessionId, derivedTopicScope, actorId, tokenProofHash],
      );
      rows = result.rows;
    } catch {
      // SQL may have COMMITed before its result was lost.
      // Never blindly re-reserve or report broker success.
      throw new Error('MQTT_RESERVATION_OUTCOME_UNKNOWN');
    }

    if (!Array.isArray(rows) || rows.length !== 1 ||
        rows[0] === null || typeof rows[0] !== 'object' ||
        Array.isArray(rows[0])) {
      throw new Error('MQTT_RESERVATION_RESPONSE_INVALID');
    }
    const row = rows[0] as Record<string, unknown>;
    const operationId = row.operationId;
    const identityId = row.identityId;
    if (
      typeof operationId !== 'string' || !UUID_V4.test(operationId) ||
      typeof identityId !== 'string' || !UUID_V4.test(identityId) ||
      typeof row.username !== 'string' ||
      typeof row.clientId !== 'string' ||
      typeof row.roleName !== 'string' ||
      row.reservedTopicScope !== derivedTopicScope
    ) {
      throw new Error('MQTT_RESERVATION_RESPONSE_INVALID');
    }
    const suffix = identityId.replace(/-/g, '');
    if (
      row.username !== `shd_${suffix}` ||
      row.clientId !== `shd-${suffix}` ||
      row.roleName !== `role_shd_${suffix}`
    ) {
      throw new Error('MQTT_RESERVATION_BINDING_INVALID');
    }
    return {
      operationId,
      identityId,
      username: row.username,
      clientId: row.clientId,
      roleName: row.roleName,
      reservedTopicScope: derivedTopicScope,
    };
  }
}
