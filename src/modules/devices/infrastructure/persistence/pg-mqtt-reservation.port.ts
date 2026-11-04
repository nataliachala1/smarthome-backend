import type { MqttPrivilegedReservationPort } from '../../application/services/shelly-mqtt-reservation.coordinator';

/**
 * Port de acceso SQL. Debe recibir un pool PostgreSQL EXCLUSIVO del rol
 * LOGIN especializado que hereda smarthome_mqtt_registrar.
 * No usar PrismaRlsService, DATABASE_URL ni las credenciales smarthome_app.
 *
 * Compatible estructuralmente con pg.Pool.query, sin abrir conexiones aqui.
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
 * Ejecuta SOLO la funcion de reserva 022; no provisiona MQTT ni cambia
 * el estado de una sesion o de una identidad.
 *
 * El llamador debe autorizar OWNER+token y derivar scope desde el contrato
 * backend. El SQL comprueba la vigencia, el estado y conflictos del ID fisico.
 * No registrar este adapter en DevicesModule hasta configurar un rol SQL
 * independiente y confirmar migraciones 022/023 en el entorno de destino.
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

    // Unica operacion con efectos: la funcion SECURITY DEFINER valida la
    // sesion y bloquea el identificador fisico antes de insertar la reserva.
    // No interpolar identificadores ni valores en la sentencia SQL.
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
      // No exponer detalles SQL, roles, hosts ni mensajes de PostgreSQL.
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
