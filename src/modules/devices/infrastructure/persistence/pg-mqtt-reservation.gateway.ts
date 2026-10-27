import { Pool, type PoolConfig } from 'pg';
import type { MqttReservationQueryClient } from './pg-mqtt-privileged-reservation.port';

/** Restricted SQL 022 connector. Lab-only until production secrets and TLS exist. */
export interface ReservationTarget {
  readonly role: string;
  readonly database: string;
  readonly options: PoolConfig;
}

export function parseMqttReservationLabConnection(
  urlText: string | undefined,
  environment: string | undefined = process.env.NODE_ENV,
): ReservationTarget {
  if (environment === 'production') throw new Error('MQTT_RESERVER_TARGET_FORBIDDEN');
  let u: URL;
  try {
    if (!urlText) throw new Error('empty');
    u = new URL(urlText);
  } catch {
    throw new Error('MQTT_RESERVER_DATABASE_URL_INVALID');
  }
  const role = decodeURIComponent(u.username);
  const database = decodeURIComponent(u.pathname.slice(1));
  if (u.protocol !== 'postgresql:' ||
      u.hostname !== 'smarthome_pg_039_lab' || u.port !== '5432' ||
      role !== 'smarthome_mqtt_reserver_lab039_login' ||
      database !== 'smarthome_039_lab' ||
      !/^[A-Za-z0-9_-]{43}$/.test(u.password) ||
      u.search !== '' || u.hash !== '') {
    throw new Error('MQTT_RESERVER_TARGET_FORBIDDEN');
  }
  return {
    role,
    database,
    options: {
      connectionString: urlText,
      ssl: false,
      max: 1,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 4000,
      query_timeout: 5000,
      application_name: 'smarthome_mqtt_reserver_lab',
    },
  };
}

export const RESERVATION_PRIVILEGE_SQL = `
SELECT current_user::text AS role, current_database()::text AS database,
  pg_has_role(current_user, 'smarthome_mqtt_reserver', 'USAGE') AS reserver_usage,
  pg_has_role(current_user, 'smarthome_mqtt_lease_worker', 'MEMBER') AS lease_member,
  pg_has_role(current_user, 'smarthome_mqtt_prepare_confirmer', 'MEMBER') AS confirmer_member,
  pg_has_role(current_user, 'smarthome_mqtt_registrar', 'MEMBER') AS registrar_member,
  pg_has_role(current_user, 'smarthome_mqtt_revoke', 'MEMBER') AS revoke_member,
  has_schema_privilege(current_user, 'devices', 'USAGE') AS schema_usage,
  has_function_privilege(current_user,
    'devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)', 'EXECUTE') AS can_reserve,
  has_function_privilege(current_user,
    'devices.fn_claim_mqtt_pairing_preparation(uuid,integer)', 'EXECUTE') AS can_claim,
  has_function_privilege(current_user,
    'devices.fn_report_mqtt_pairing_uncertain(uuid,uuid,text)', 'EXECUTE') AS can_report,
  has_function_privilege(current_user,
    'devices.fn_quarantine_expired_mqtt_pairing_lease(uuid)', 'EXECUTE') AS can_quarantine,
  has_function_privilege(current_user,
    'devices.fn_confirm_mqtt_pairing_prepared(uuid,uuid,uuid,text,text,text)', 'EXECUTE') AS can_confirm,
  has_function_privilege(current_user,
    'devices.fn_register_mqtt_identity(uuid,uuid,text)', 'EXECUTE') AS can_register,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'SELECT') AS operation_select,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'INSERT') AS operation_insert,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'UPDATE') AS operation_update,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'DELETE') AS operation_delete,
  has_table_privilege(current_user, 'devices.mqtt_identity', 'SELECT') AS identity_select,
  has_table_privilege(current_user, 'devices.device_pairing_session', 'SELECT') AS session_select,
  r.rolsuper AS superuser, r.rolbypassrls AS bypass_rls,
  r.rolcreaterole AS create_role, r.rolcreatedb AS create_db,
  r.rolreplication AS replication, r.rolcanlogin AS can_login,
  r.rolinherit AS inherits,
  (SELECT count(*)::int FROM pg_catalog.pg_auth_members m
     WHERE m.member = r.oid) AS direct_memberships
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`;

export const EXPECTED_RESERVER_ROLE = 'smarthome_mqtt_reserver_lab039_login';
export const EXPECTED_RESERVER_DATABASE = 'smarthome_039_lab';

/** Fail-closed; rejects extra memberships, SQL 025/027 grants and table DML. */
export function isMinimalMqttReservationPrivilegeRow(row: unknown): boolean {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
  const r = row as Record<string, unknown>;
  const truthy = ['reserver_usage', 'schema_usage', 'can_reserve', 'can_login', 'inherits'];
  const falsy = [
    'lease_member', 'confirmer_member', 'registrar_member', 'revoke_member',
    'can_claim', 'can_report', 'can_quarantine', 'can_confirm', 'can_register',
    'operation_select', 'operation_insert', 'operation_update', 'operation_delete',
    'identity_select', 'session_select', 'superuser', 'bypass_rls',
    'create_role', 'create_db', 'replication',
  ];
  return r.role === EXPECTED_RESERVER_ROLE &&
    r.database === EXPECTED_RESERVER_DATABASE &&
    r.direct_memberships === 1 &&
    truthy.every((key) => r[key] === true) &&
    falsy.every((key) => r[key] === false);
}

/** Exact SQL generated by PgMqttPrivilegedReservationPort in SQL 022. */
const RESERVATION_ALLOWED_SQL = `SELECT operation_id::text AS "operationId",
                identity_id::text AS "identityId",
                username::text AS "username",
                client_id::text AS "clientId",
                role_name::text AS "roleName",
                reserved_topic_scope::text AS "reservedTopicScope"
           FROM devices.fn_reserve_mqtt_pairing_operation(
             $1::uuid, $2::text, $3::uuid, $4::text
           )`;
const RESERVATION_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RESERVATION_PROOF = /^[0-9a-f]{64}$/;
const RESERVATION_TOPIC_SCOPE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

/** No arbitrary SQL, no alternative function calls, no concatenated statements.
 * Normalization ignores ONLY whitespace. Input validation duplicates the
 * public adapter's shape checks as a defense in depth, without trusting it. */
export function isAllowedMqttReservationQuery(sql: unknown, params: unknown): boolean {
  if (typeof sql !== 'string' || !Array.isArray(params) || params.length !== 4) {
    return false;
  }
  if (sql.replace(/\s+/g, ' ').trim() !==
      RESERVATION_ALLOWED_SQL.replace(/\s+/g, ' ').trim()) {
    return false;
  }
  const validatedParams: unknown[] = params;
  const [sessionId, topicScope, actorId, tokenProofHash] = validatedParams;
  return typeof sessionId === 'string' && RESERVATION_UUID_V4.test(sessionId) &&
    typeof actorId === 'string' && RESERVATION_UUID_V4.test(actorId) &&
    typeof topicScope === 'string' && topicScope.length >= 1 &&
    topicScope.length <= 256 && RESERVATION_TOPIC_SCOPE.test(topicScope) &&
    typeof tokenProofHash === 'string' && RESERVATION_PROOF.test(tokenProofHash);
}

type QueryResult = { rows: unknown[] };
export interface ReservationPool {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

/** Not registered in DI. Never expose pool before privilege verification. */
export class PgMqttReservationGateway implements MqttReservationQueryClient {
  private verified = false;
  constructor(private readonly pool: ReservationPool) {}

  async verifyPrivileges(): Promise<void> {
    this.verified = false;
    try {
      const result = await this.pool.query(RESERVATION_PRIVILEGE_SQL);
      if (!Array.isArray(result.rows) || result.rows.length !== 1 ||
          !isMinimalMqttReservationPrivilegeRow(result.rows[0])) {
        throw new Error('privilege mismatch');
      }
      this.verified = true;
    } catch {
      throw new Error('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
    }
  }

  async query(sql: string, params: unknown[]): Promise<QueryResult> {
    if (!this.verified) throw new Error('MQTT_RESERVER_NOT_READY');
    if (!isAllowedMqttReservationQuery(sql, params)) {
      throw new Error('MQTT_RESERVER_SQL_NOT_ALLOWED');
    }
    return this.pool.query(sql, params);
  }

  async close(): Promise<void> {
    this.verified = false;
    await this.pool.end();
  }
}

export async function openMqttReservationLabGateway(
  url: string | undefined,
): Promise<PgMqttReservationGateway> {
  const target = parseMqttReservationLabConnection(url);
  const pool = new Pool(target.options);
  const gateway = new PgMqttReservationGateway(pool);
  try {
    await gateway.verifyPrivileges();
    return gateway;
  } catch {
    await gateway.close();
    throw new Error('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
  }
}
