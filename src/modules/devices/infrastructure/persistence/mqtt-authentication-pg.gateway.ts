import type { OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import type { IsolatedMqttAuthSqlClient } from './pg-mqtt-authentication.ports';

export type MqttAuthKind = 'rpc' | 'confirm';
const LOGINS: Record<MqttAuthKind, string> = {
  rpc: 'smarthome_mqtt_rpc_dev_login',
  confirm: 'smarthome_mqtt_auth_dev_login',
};
const TEMPLATES: Record<MqttAuthKind, readonly [string, number][]> = {
  rpc: [
    [`SELECT rpc_id::text AS "rpcId", manufacturer_device_id AS "manufacturerDeviceId",
           request_topic AS "requestTopic", response_topic AS "responseTopic",
           request_source AS "requestSource", issued_at AS "issuedAt",
           expires_at AS "expiresAt", broker_username AS "brokerUsername",
           broker_client_id AS "brokerClientId", broker_role_name AS "brokerRoleName"
         FROM devices.fn_issue_mqtt_rpc_challenge($1::uuid)`, 1],
    ['SELECT devices.fn_consume_mqtt_rpc_candidate($1::uuid,$2::uuid) AS consumed', 2],
  ],
  confirm: [
    [`SELECT devices.fn_confirm_mqtt_broker_authentication(
          $1::uuid,$2::uuid,$3::text,$4::text,$5::text
         ) AS confirmed`, 5],
  ],
};
const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

export type MqttAuthPgMode = 'local-dev' | 'vps-dev-tls';

export interface MqttAuthPgTarget {
  readonly role: string;
  readonly database: string;
  readonly options: PoolConfig;
}

/** Separación explícita de entornos; no admite decidir el modo desde HTTP. */
export function parseMqttAuthPgConnection(
  raw: string | undefined,
  kind: MqttAuthKind,
  mode: MqttAuthPgMode,
  environment: string | undefined = process.env.NODE_ENV,
): MqttAuthPgTarget {
  if (mode === 'local-dev' && environment !== 'development') {
    throw new Error('MQTT_AUTH_PG_DEV_ONLY');
  }
  if (!raw) throw new Error('MQTT_AUTH_PG_URL_INVALID');
  let url: URL;
  let username: string;
  let database: string;
  try {
    url = new URL(raw);
    username = decodeURIComponent(url.username);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error('MQTT_AUTH_PG_URL_INVALID');
  }
  if (url.protocol !== 'postgresql:' || url.port !== '5432' ||
      username !== LOGINS[kind] ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.password) ||
      url.search !== '' || url.hash !== '') {
    throw new Error('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
  }
  const local = mode === 'local-dev' && environment === 'development' &&
    url.hostname === '127.0.0.1' && database === 'smarthome';
  const vps = mode === 'vps-dev-tls' && environment === 'production' &&
    url.hostname === 'smart-home-smarthomepostgresdev-vrmtpz' &&
    database === 'smarthome_dev';
  if (!local && !vps) {
    throw new Error('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
  }
  return {
    role: username,
    database,
    options: {
      connectionString: raw,
      ssl: vps ? { rejectUnauthorized: true, minVersion: 'TLSv1.2' } : false,
      max: 1,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      query_timeout: 5000,
      statement_timeout: 4000,
      application_name: `smarthome_mqtt_auth_${kind}`,
    },
  };
}

/** Compatibilidad del contrato local previo. */
export function parseMqttAuthPgUrl(raw: string | undefined, kind: MqttAuthKind): {
  role: string;
  connectionString: string;
} {
  const target = parseMqttAuthPgConnection(raw, kind, 'local-dev');
  return { role: target.role, connectionString: raw! };
}

export function isMinimalMqttAuthPgPrivileges(
  row: unknown, kind: MqttAuthKind, database = 'smarthome',
): boolean {
  if (!row || typeof row !== 'object') return false;
  const v = row as Record<string, unknown>;
  return v.login === LOGINS[kind] && v.db === database &&
    v.member_rpc === (kind === 'rpc') && v.member_confirm === (kind === 'confirm') &&
    v.usable_rpc === (kind === 'rpc') && v.usable_confirm === (kind === 'confirm') &&
    v.memberships === 1 &&
    v.can_issue === (kind === 'rpc') && v.can_consume === (kind === 'rpc') &&
    v.can_confirm === (kind === 'confirm') &&
    v.can_reserve === false && v.can_prepare === false &&
    v.can_register === false && v.can_finish === false &&
    v.can_read_operations === false && v.can_edit_operations === false &&
    v.can_read_secrets === false && v.can_write_secrets === false &&
    v.privileged === false;
}

// SQL de introspección, sin tablas del usuario ni secretos.
const CHECK_SQL = `SELECT current_user::text AS login, current_database()::text AS db,
  pg_has_role(current_user,'smarthome_mqtt_rpc_worker','MEMBER') AS member_rpc,
  pg_has_role(current_user,'smarthome_mqtt_auth_confirmer','MEMBER') AS member_confirm,
  pg_has_role(current_user,'smarthome_mqtt_rpc_worker','USAGE') AS usable_rpc,
  pg_has_role(current_user,'smarthome_mqtt_auth_confirmer','USAGE') AS usable_confirm,
  (SELECT count(*)::integer FROM pg_catalog.pg_auth_members m
   WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS memberships,
  has_function_privilege(current_user,'devices.fn_issue_mqtt_rpc_challenge(uuid)','EXECUTE') AS can_issue,
  has_function_privilege(current_user,'devices.fn_consume_mqtt_rpc_candidate(uuid,uuid)','EXECUTE') AS can_consume,
  has_function_privilege(current_user,'devices.fn_confirm_mqtt_broker_authentication(uuid,uuid,text,text,text)','EXECUTE') AS can_confirm,
  has_function_privilege(current_user,'devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)','EXECUTE') AS can_reserve,
  has_function_privilege(current_user,'devices.fn_confirm_mqtt_pairing_prepared(uuid,uuid,uuid,text,text,text)','EXECUTE') AS can_prepare,
  has_function_privilege(current_user,'devices.fn_register_mqtt_identity(uuid,uuid,text)','EXECUTE') AS can_register,
  has_function_privilege(current_user,'devices.fn_finish_verified_pairing(uuid,uuid)','EXECUTE') AS can_finish,
  has_table_privilege(current_user,'devices.mqtt_pairing_operation','SELECT') AS can_read_operations,
  has_table_privilege(current_user,'devices.mqtt_pairing_operation','INSERT,UPDATE,DELETE') AS can_edit_operations,
  has_table_privilege(current_user,'devices.mqtt_preparation_secret','SELECT') AS can_read_secrets,
  has_table_privilege(current_user,'devices.mqtt_preparation_secret','INSERT,UPDATE,DELETE') AS can_write_secrets,
  (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls) AS privileged
FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;

export interface MqttAuthPgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

export class MqttAuthenticationPgGateway implements IsolatedMqttAuthSqlClient, OnModuleDestroy {
  private verified = false;
  constructor(private readonly pool: MqttAuthPgPool,
              private readonly kind: MqttAuthKind,
              private readonly database = 'smarthome') {}

  async verifyPrivileges(): Promise<void> {
    this.verified = false;
    try {
      const result = await this.pool.query(CHECK_SQL);
      if (result.rows.length !== 1 ||
          !isMinimalMqttAuthPgPrivileges(result.rows[0], this.kind, this.database)) {
        throw new Error('INVALID_PRIVILEGES');
      }
      this.verified = true;
    } catch { throw new Error('MQTT_AUTH_PG_PRIVILEGES_REJECTED'); }
  }

  async query(sql: string, params: readonly unknown[]): Promise<{ rows: unknown[] }> {
    if (!this.verified || !Array.isArray(params) ||
        !TEMPLATES[this.kind].some(([template, count]) =>
          normalize(sql) === normalize(template) && params.length === count)) {
      throw new Error('MQTT_AUTH_PG_QUERY_REJECTED');
    }
        const values: unknown[] = Array.from(params);
    return this.pool.query(sql, values);
  }

  async onModuleDestroy(): Promise<void> {
    this.verified = false;
    await this.pool.end();
  }
}

export async function openMqttAuthPgGateway(
  raw: string | undefined,
  kind: MqttAuthKind,
  mode: MqttAuthPgMode = 'local-dev',
): Promise<MqttAuthenticationPgGateway> {
  const target = parseMqttAuthPgConnection(raw, kind, mode);
  const pool = new Pool(target.options);
  const gateway = new MqttAuthenticationPgGateway(pool, kind, target.database);
  try {
    await gateway.verifyPrivileges();
    return gateway;
  } catch (e) {
    await gateway.onModuleDestroy().catch(() => undefined);
    throw e;
  }
}
