import { Pool, type PoolConfig } from 'pg';
import type { MqttSecretSqlQueryPort } from './pg-mqtt-preparation-secret.repository';

/** LAB039 exclusivamente. Sin registro de DI, HTTP, MQTT ni uso en produccion. */
export interface SecretLab039Target {
  readonly role: string;
  readonly database: string;
  readonly options: PoolConfig;
}

const LOGIN = 'smarthome_mqtt_secret_lab039_login';
const DATABASE = 'smarthome_039_lab';
const HOST = 'smarthome_pg_039_lab';
const SECRET_LOAD_SQL = `SELECT operation_id, format_version, key_id, nonce,
  ciphertext, auth_tag
FROM devices.fn_load_mqtt_preparation_secret($1::uuid, $2::uuid)`;
const SECRET_INSERT_SQL = `SELECT devices.fn_insert_mqtt_preparation_secret_if_absent(
  $1::uuid, $2::uuid, $3::smallint, $4::text, $5::text, $6::text, $7::text
) AS inserted`;

export function parseSecretLab039Url(raw: string | undefined, env: string | undefined): SecretLab039Target {
  if (env !== 'development' && env !== 'test') throw new Error('MQTT_SECRET_LAB039_ENV_FORBIDDEN');
  let url: URL;
  try { if (!raw) throw new Error('empty'); url = new URL(raw); }
  catch { throw new Error('MQTT_SECRET_LAB039_URL_INVALID'); }
  if (url.protocol !== 'postgresql:' || url.hostname !== HOST || url.port !== '5432' ||
      url.username !== LOGIN || url.pathname !== '/' + DATABASE ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.password) || url.search !== '' ||
      url.hash !== '' || url.hostname.includes('@')) {
    throw new Error('MQTT_SECRET_LAB039_TARGET_FORBIDDEN');
  }
  return {
    role: LOGIN, database: DATABASE,
    options: {
      host: HOST, port: 5432, database: DATABASE, user: LOGIN, password: url.password,
      ssl: false, max: 1, connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 10000, query_timeout: 7000,
      statement_timeout: 6000, application_name: 'smarthome_secret_lab039_gateway',
    },
  };
}

/** Consulta de verificacion hecha CON el login real, no como administrador. */
export const SECRET_LAB039_PRIVILEGE_SQL = `
SELECT current_database()::text AS database, current_user::text AS role,
  session_user::text AS session_role,
  r.rolcanlogin AS can_login, r.rolinherit AS inherits,
  r.rolsuper AS superuser, r.rolcreatedb AS create_db,
  r.rolcreaterole AS create_role, r.rolreplication AS replication,
  r.rolbypassrls AS bypass_rls,
  (SELECT count(*)::integer FROM pg_catalog.pg_auth_members m
   WHERE m.member=r.oid) AS direct_memberships,
  pg_has_role(current_user, 'smarthome_mqtt_secret_worker', 'USAGE') AS secret_member,
  pg_has_role(current_user, 'smarthome_mqtt_reserver', 'MEMBER') AS reserver_member,
  pg_has_role(current_user, 'smarthome_mqtt_lease_worker', 'MEMBER') AS lease_member,
  pg_has_role(current_user, 'smarthome_mqtt_prepare_confirmer', 'MEMBER') AS confirmer_member,
  pg_has_role(current_user, 'smarthome_owner', 'MEMBER') AS owner_member,
  has_schema_privilege(current_user, 'devices', 'USAGE') AS schema_usage,
  has_function_privilege(current_user,
    'devices.fn_load_mqtt_preparation_secret(uuid,uuid)', 'EXECUTE') AS can_load,
  has_function_privilege(current_user,
    'devices.fn_insert_mqtt_preparation_secret_if_absent(uuid,uuid,smallint,text,text,text,text)',
    'EXECUTE') AS can_insert,
  has_function_privilege(current_user,
    'devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)', 'EXECUTE') AS can_reserve,
  has_function_privilege(current_user,
    'devices.fn_claim_mqtt_pairing_preparation(uuid,integer)', 'EXECUTE') AS can_claim,
  has_function_privilege(current_user,
    'devices.fn_confirm_mqtt_pairing_prepared(uuid,uuid,uuid,text,text,text)',
    'EXECUTE') AS can_confirm,
  has_table_privilege(current_user, 'devices.mqtt_preparation_secret', 'SELECT') AS secret_select,
  has_table_privilege(current_user, 'devices.mqtt_preparation_secret', 'INSERT') AS secret_insert,
  has_table_privilege(current_user, 'devices.mqtt_preparation_secret', 'UPDATE') AS secret_update,
  has_table_privilege(current_user, 'devices.mqtt_preparation_secret', 'DELETE') AS secret_delete,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'SELECT') AS operation_select,
  has_table_privilege(current_user, 'devices.mqtt_identity', 'SELECT') AS identity_select
FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;

export function hasMinimalSecretLab039Privileges(row: unknown): boolean {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const r = row as Record<string, unknown>;
  if (r.database !== DATABASE || r.role !== LOGIN || r.session_role !== LOGIN ||
      r.direct_memberships !== 1) return false;
  const required = ['can_login', 'inherits', 'secret_member', 'schema_usage', 'can_load', 'can_insert'];
  const denied = ['superuser', 'create_db', 'create_role', 'replication', 'bypass_rls',
    'reserver_member', 'lease_member', 'confirmer_member', 'owner_member',
    'can_reserve', 'can_claim', 'can_confirm', 'secret_select', 'secret_insert',
    'secret_update', 'secret_delete', 'operation_select', 'identity_select'];
  return required.every(k => r[k] === true) && denied.every(k => r[k] === false);
}

function canonical(sql: string): string { return sql.replace(/\s+/g, ' ').trim(); }
const ALLOWED_LOAD = canonical(SECRET_LOAD_SQL);
const ALLOWED_INSERT = canonical(SECRET_INSERT_SQL);

export interface SecretLab039Pool {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

export class PgMqttSecretLab039Gateway implements MqttSecretSqlQueryPort {
  private verified = false;
  constructor(private readonly pool: SecretLab039Pool) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.end !== 'function') {
      throw new Error('MQTT_SECRET_LAB039_POOL_INVALID');
    }
  }
  async verifyPrivileges(): Promise<void> {
    this.verified = false;
    try {
      const answer = await this.pool.query(SECRET_LAB039_PRIVILEGE_SQL);
      if (!answer || !Array.isArray(answer.rows) || answer.rows.length !== 1 ||
          !hasMinimalSecretLab039Privileges(answer.rows[0])) throw new Error('privileges');
      this.verified = true;
    } catch { throw new Error('MQTT_SECRET_LAB039_PRIVILEGES_UNVERIFIED'); }
  }
  async query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    if (!this.verified) throw new Error('MQTT_SECRET_LAB039_NOT_READY');
    if (typeof sql !== 'string' || !Array.isArray(params) ||
        !((canonical(sql) === ALLOWED_LOAD && params.length === 2) ||
          (canonical(sql) === ALLOWED_INSERT && params.length === 7))) {
      throw new Error('MQTT_SECRET_LAB039_SQL_NOT_ALLOWED');
    }
    return this.pool.query(sql, params);
  }
  async close(): Promise<void> { this.verified = false; await this.pool.end(); }
}

export async function openPgMqttSecretLab039Gateway(raw: string | undefined): Promise<PgMqttSecretLab039Gateway> {
  const target = parseSecretLab039Url(raw, process.env.NODE_ENV);
  const gateway = new PgMqttSecretLab039Gateway(new Pool(target.options));
  try { await gateway.verifyPrivileges(); return gateway; }
  catch { await gateway.close(); throw new Error('MQTT_SECRET_LAB039_PRIVILEGES_UNVERIFIED'); }
}
