import type { OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import type { MqttLeaseQueryClient } from './pg-mqtt-preparation-lease.port';
import type { MqttPreparedConfirmationQueryClient } from './pg-mqtt-prepared-confirmation.port';

/** Separa conexiones y permisos del worker de leases y del confirmador 027. */
export type MqttWorkerKind = 'lease' | 'confirmer';
export type MqttWorkerConnectionMode = 'lab' | 'local-dev' | 'remote-tls' | 'vps-dev-tls';

export interface MqttWorkerConnectionTarget {
  readonly role: string;
  readonly database: string;
  readonly options: PoolConfig;
}

const LOCAL_ROLE: Record<MqttWorkerKind, string> = {
  lease: 'smarthome_mqtt_lease_dev_login',
  confirmer: 'smarthome_mqtt_confirmer_dev_login',
};
const LAB_ROLE: Record<MqttWorkerKind, string> = {
  lease: 'smarthome_mqtt_lease_lab039_login',
  confirmer: 'smarthome_mqtt_confirmer_lab039_login',
};
const REMOTE_ROLE: Record<MqttWorkerKind, RegExp> = {
  lease: /^smarthome_mqtt_lease_[a-z0-9_]+$/,
  confirmer: /^smarthome_mqtt_confirmer_[a-z0-9_]+$/,
};

export function parseMqttWorkerConnection(
  connectionString: string | undefined,
  kind: MqttWorkerKind,
  mode: MqttWorkerConnectionMode,
  environment: string | undefined = process.env.NODE_ENV,
): MqttWorkerConnectionTarget {
  let url: URL;
  try {
    if (!connectionString) throw new Error();
    url = new URL(connectionString);
  } catch {
    throw new Error('MQTT_WORKER_DATABASE_URL_INVALID');
  }
  const role = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1));
  const port = Number(url.port);
  if (url.protocol !== 'postgresql:' || !url.hostname ||
      !/^\d{1,5}$/.test(url.port) || port < 1 || port > 65535 ||
      !url.password || !REMOTE_ROLE[kind].test(role) ||
      !/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(database) ||
      url.search !== '' || url.hash !== '') {
    throw new Error('MQTT_WORKER_DATABASE_URL_INVALID');
  }
  if (mode === 'lab') {
    if (!/^[A-Za-z0-9_-]{43}$/.test(url.password)) {
      throw new Error('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    }
    // Only the explicitly named disposable PostgreSQL container on its
    // private Docker network. Never use in production or on a host port.
    if (environment === 'production' || url.hostname !== 'smarthome_pg_039_lab' ||
        port !== 5432 || database !== 'smarthome_039_lab' ||
        role !== LAB_ROLE[kind]) {
      throw new Error('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    }
  } else if (mode === 'local-dev') {
    if (environment !== 'development' || url.hostname !== '127.0.0.1' ||
        port !== 5432 || database !== 'smarthome' || role !== LOCAL_ROLE[kind]) {
      throw new Error('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    }
  } else if (mode === 'vps-dev-tls') {
    // El modo de VPS es explícito; no modifica las reglas de laboratorio/remoto.
    if (environment !== 'production' ||
        url.hostname !== 'smart-home-smarthomepostgresdev-vrmtpz' ||
        port !== 5432 || database !== 'smarthome_dev' ||
        role !== LOCAL_ROLE[kind] ||
        !/^[A-Za-z0-9_-]{43}$/.test(url.password)) {
      throw new Error('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    }
  } else if (mode === 'remote-tls') {
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
        ['smarthome_test', 'smarthome_027_lab', 'smarthome_039_lab'].includes(database) ||
        role === LOCAL_ROLE[kind] || role === LAB_ROLE[kind] ||
        ['smarthome_mqtt_lease_lab_login', 'smarthome_mqtt_confirmer_lab_login'].includes(role)) {
      throw new Error('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    }
  } else {
    throw new Error('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
  }
  return {
    role,
    database,
    options: {
      connectionString,
      ssl: (mode === 'lab' || mode === 'local-dev')
        ? false : { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      max: 2,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 4000,
      query_timeout: 5000,
      application_name: `smarthome_mqtt_${kind}`,
    },
  };
}

/** Strict SQL templates matching the two implemented lease operations and one
 * prepared confirmation operation. An additional SQL025 quarantine call must
 * have its own reviewed adapter and allowlist entry before first use. */
const WORKER_ALLOWED_SQL: Record<MqttWorkerKind, ReadonlyArray<{ sql: string; count: number }>> = {
  lease: [
    {
      sql: `SELECT devices.fn_request_mqtt_enable($1::uuid,$2::uuid,$3::text) AS requested`,
      count: 3,
    },
    {
      sql: `SELECT operation_id::text AS "operationId", lease_token::text AS "leaseToken",
  lease_until AS "leaseUntil", identity_id::text AS "identityId",
  username, client_id AS "clientId", role_name AS "roleName"
  FROM devices.fn_claim_mqtt_enable($1::uuid,$2::integer)`,
      count: 2,
    },
    {
      sql: `SELECT devices.fn_confirm_mqtt_enabled($1::uuid,$2::uuid,$3::text,$4::text,$5::text) AS confirmed`,
      count: 5,
    },
    {
      sql: `SELECT operation_id::text AS "operationId",
                assigned_token::text AS "leaseToken",
                expires_at AS "expiresAt",
                attempt_number AS "attemptNumber"
         FROM devices.fn_claim_mqtt_pairing_preparation($1::uuid, $2::integer)`,
      count: 2,
    },
    {
      sql: `SELECT devices.fn_report_mqtt_pairing_uncertain(
           $1::uuid, $2::uuid, $3::text
         ) AS reported`,
      count: 3,
    },
  ],
  confirmer: [
    {
      sql: `SELECT devices.fn_confirm_mqtt_pairing_prepared(
           $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
         ) AS confirmed`,
      count: 6,
    },
  ],
};

/** Ignore benign spacing only; never accept appended statements or comments. */
function canonicalWorkerSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function isAllowedMqttWorkerQuery(
  sql: unknown,
  params: unknown,
  kind: MqttWorkerKind,
): boolean {
  if (typeof sql !== 'string' || !Array.isArray(params) ||
      !Object.prototype.hasOwnProperty.call(WORKER_ALLOWED_SQL, kind)) return false;
  const canonical = canonicalWorkerSql(sql);
  return WORKER_ALLOWED_SQL[kind].some(
    (template) => canonical === canonicalWorkerSql(template.sql) &&
      params.length === template.count,
  );
}

type QueryResponse = { rows: unknown[] };
export interface MqttWorkerPgPool {
  query(sql: string, params?: unknown[]): Promise<QueryResponse>;
  end(): Promise<void>;
}

const PRIVILEGE_SQL = `
SELECT current_user::text AS role, current_database()::text AS database,
  pg_has_role(current_user, 'smarthome_mqtt_lease_worker', 'MEMBER') AS lease_member,
  pg_has_role(current_user, 'smarthome_mqtt_prepare_confirmer', 'MEMBER') AS confirmer_member,
  pg_has_role(current_user, 'smarthome_mqtt_reserver', 'MEMBER') AS reserver_member,
  pg_has_role(current_user, 'smarthome_mqtt_registrar', 'MEMBER') AS registrar_member,
  pg_has_role(current_user, 'smarthome_mqtt_revoke', 'MEMBER') AS revoke_member,
  has_function_privilege(current_user,
    'devices.fn_claim_mqtt_pairing_preparation(uuid,integer)', 'EXECUTE') AS can_claim,
  has_function_privilege(current_user,
    'devices.fn_report_mqtt_pairing_uncertain(uuid,uuid,text)', 'EXECUTE') AS can_report,
  has_function_privilege(current_user,
    'devices.fn_quarantine_expired_mqtt_pairing_lease(uuid)', 'EXECUTE') AS can_quarantine,
  has_function_privilege(current_user,
    'devices.fn_confirm_mqtt_pairing_prepared(uuid,uuid,uuid,text,text,text)', 'EXECUTE') AS can_confirm,
  has_function_privilege(current_user,
    'devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)', 'EXECUTE') AS can_reserve,
  has_function_privilege(current_user,
    'devices.fn_register_mqtt_identity(uuid,uuid,text)', 'EXECUTE') AS can_register,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'SELECT') AS can_read_operation,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'INSERT') AS can_insert_operation,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'UPDATE') AS can_update_operation,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'DELETE') AS can_delete_operation,
  has_table_privilege(current_user, 'devices.mqtt_identity', 'SELECT') AS can_read_identity,
  r.rolsuper AS is_superuser, r.rolbypassrls AS bypass_rls,
  r.rolcreaterole AS can_create_role, r.rolcreatedb AS can_create_db
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`;

export interface MqttWorkerPrivilegeRow {
  role: string;
  database: string;
  lease_member: boolean;
  confirmer_member: boolean;
  reserver_member: boolean;
  registrar_member: boolean;
  revoke_member: boolean;
  can_claim: boolean;
  can_report: boolean;
  can_quarantine: boolean;
  can_confirm: boolean;
  can_reserve: boolean;
  can_register: boolean;
  can_read_operation: boolean;
  can_insert_operation: boolean;
  can_update_operation: boolean;
  can_delete_operation: boolean;
  can_read_identity: boolean;
  is_superuser: boolean;
  bypass_rls: boolean;
  can_create_role: boolean;
  can_create_db: boolean;
}

/** Comprobable con mocks antes de abrir una conexion SQL real. */
export function isMinimalMqttWorkerPrivilegeRow(
  row: unknown,
  target: Pick<MqttWorkerConnectionTarget, 'role' | 'database'>,
  kind: MqttWorkerKind,
): boolean {
  if (!row || typeof row !== 'object') return false;
  const r = row as Partial<MqttWorkerPrivilegeRow>;
  return r.role === target.role && r.database === target.database &&
    r.lease_member === (kind === 'lease') &&
    r.confirmer_member === (kind === 'confirmer') &&
    r.reserver_member === false && r.registrar_member === false &&
    r.revoke_member === false &&
    r.can_claim === (kind === 'lease') &&
    r.can_report === (kind === 'lease') &&
    r.can_quarantine === (kind === 'lease') &&
    r.can_confirm === (kind === 'confirmer') &&
    r.can_reserve === false && r.can_register === false &&
    r.can_read_operation === false && r.can_insert_operation === false &&
    r.can_update_operation === false && r.can_delete_operation === false &&
    r.can_read_identity === false &&
    r.is_superuser === false && r.bypass_rls === false &&
    r.can_create_role === false && r.can_create_db === false;
}

/** Pool privado, inactivo salvo factory opt-in. Nunca exportar el Pool. */
export class MqttWorkerPgGateway
  implements MqttLeaseQueryClient, MqttPreparedConfirmationQueryClient, OnModuleDestroy {
  private verified = false;
  constructor(
    private readonly pool: MqttWorkerPgPool,
    private readonly target: Pick<MqttWorkerConnectionTarget, 'role' | 'database'>,
    private readonly kind: MqttWorkerKind,
  ) {}

  async verifyPrivileges(): Promise<void> {
    this.verified = false;
    let result: QueryResponse;
    try {
      result = await this.pool.query(PRIVILEGE_SQL);
    } catch {
      throw new Error('MQTT_WORKER_PRIVILEGES_UNVERIFIED');
    }
    if (!Array.isArray(result.rows) || result.rows.length !== 1 ||
        !isMinimalMqttWorkerPrivilegeRow(result.rows[0], this.target, this.kind)) {
      throw new Error('MQTT_WORKER_PRIVILEGES_UNVERIFIED');
    }
    this.verified = true;
  }

  async query(sql: string, params: unknown[]): Promise<QueryResponse> {
    if (!this.verified) throw new Error('MQTT_WORKER_NOT_READY');
    if (!isAllowedMqttWorkerQuery(sql, params, this.kind)) {
      throw new Error('MQTT_WORKER_SQL_NOT_ALLOWED');
    }
    return this.pool.query(sql, params);
  }

  async onModuleDestroy(): Promise<void> {
    this.verified = false;
    await this.pool.end();
  }
}

export async function openMqttWorkerPgGateway(
  url: string | undefined,
  kind: MqttWorkerKind,
  mode: MqttWorkerConnectionMode,
): Promise<MqttWorkerPgGateway> {
  const target = parseMqttWorkerConnection(url, kind, mode);
  const pool = new Pool(target.options);
  const gateway = new MqttWorkerPgGateway(pool, target, kind);
  try {
    await gateway.verifyPrivileges();
    return gateway;
  } catch {
    await gateway.onModuleDestroy();
    throw new Error('MQTT_WORKER_PRIVILEGES_UNVERIFIED');
  }
}
