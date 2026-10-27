import type { OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import type { MqttSecretSqlQueryPort } from '../secrets/pg-mqtt-preparation-secret.repository';

/** SQL028: cuarta cuenta exclusiva, nunca la cuenta general Prisma. */
const EXPECTED_ROLE = 'smarthome_mqtt_secret_dev_login';
const LOCAL_DB = 'smarthome';
const LOCAL_HOST = '127.0.0.1';
const VPS_DEV_DB = 'smarthome_dev';
const VPS_DEV_HOST = 'smart-home-smarthomepostgresdev-vrmtpz';
const EXPECTED_PORT = '5432';
export type MqttSecretConnectionMode = 'local-dev' | 'vps-dev-tls';

export interface SecretPgTarget {
  readonly role: string;
  readonly database: string;
  readonly options: PoolConfig;
}

/** Seleccion explicita de destino: TLS obligatorio para la BD aislada VPS DEV. */
export function parseMqttSecretConnection(
  connectionString: string | undefined,
  mode: MqttSecretConnectionMode,
  environment: string | undefined = process.env.NODE_ENV,
): SecretPgTarget {
  let parsed: URL;
  let role: string;
  let database: string;
  try {
    if (!connectionString) throw new Error();
    parsed = new URL(connectionString);
    role = decodeURIComponent(parsed.username);
    database = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error('MQTT_SECRET_DATABASE_URL_INVALID');
  }
  if (parsed.protocol !== 'postgresql:' ||
      role !== EXPECTED_ROLE || !parsed.hostname ||
      parsed.port !== EXPECTED_PORT ||
      !/^[A-Za-z0-9_-]{43}$/.test(parsed.password) ||
      parsed.search !== '' || parsed.hash !== '') {
    throw new Error('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
  }
  const local = mode === 'local-dev' && environment === 'development' &&
    parsed.hostname === LOCAL_HOST && database === LOCAL_DB;
  const vps = mode === 'vps-dev-tls' && environment === 'production' &&
    parsed.hostname === VPS_DEV_HOST && database === VPS_DEV_DB;
  if (!local && !vps) {
    throw new Error('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
  }
  return {
    role,
    database,
    options: {
      connectionString,
      ssl: vps ? { rejectUnauthorized: true, minVersion: 'TLSv1.2' } : false,
      max: 2,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 4000,
      query_timeout: 5000,
      application_name: 'smarthome_mqtt_secret',
    },
  };
}

/** Compatibilidad: conserva intacto el contrato original local-dev. */
export function parseMqttSecretDevConnection(
  connectionString: string | undefined,
  environment: string | undefined = process.env.NODE_ENV,
): SecretPgTarget {
  return parseMqttSecretConnection(connectionString, 'local-dev', environment);
}

const LOAD_SQL = `SELECT operation_id, format_version, key_id, nonce,
  ciphertext, auth_tag
FROM devices.fn_load_mqtt_preparation_secret($1::uuid, $2::uuid)`;
const INSERT_SQL = `SELECT devices.fn_insert_mqtt_preparation_secret_if_absent(
  $1::uuid, $2::uuid, $3::smallint, $4::text, $5::text, $6::text, $7::text
) AS inserted`;
import { MQTT_BOOTSTRAP_ENVELOPE_SQL } from './pg-mqtt-bootstrap.port';
const canonical = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

export function allowedMqttSecretQuery(sql: unknown, params: unknown): boolean {
  if (typeof sql !== 'string' || !Array.isArray(params)) return false;
  const s = canonical(sql);
  return (s === canonical(LOAD_SQL) && params.length === 2) ||
    (s === canonical(INSERT_SQL) && params.length === 7) ||
    (s === canonical(MQTT_BOOTSTRAP_ENVELOPE_SQL) && params.length === 3);
}

export interface MqttSecretPgPool {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

const PRIVILEGES_SQL = `
SELECT current_user::text AS role, current_database()::text AS database,
  r.rolinherit AS inherit, r.rolsuper AS superuser,
  r.rolbypassrls AS bypassrls, r.rolcreaterole AS createrole,
  r.rolcreatedb AS createdb, r.rolreplication AS replication,
  pg_has_role(current_user, 'smarthome_mqtt_secret_worker', 'MEMBER') AS secret_member,
  pg_has_role(current_user, 'smarthome_mqtt_reserver', 'MEMBER') AS reserve_member,
  pg_has_role(current_user, 'smarthome_mqtt_lease_worker', 'MEMBER') AS lease_member,
  pg_has_role(current_user, 'smarthome_mqtt_prepare_confirmer', 'MEMBER') AS confirm_member,
  (SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid) AS membership_count,
  has_function_privilege(current_user,
    'devices.fn_load_mqtt_preparation_secret(uuid,uuid)','EXECUTE') AS can_load,
  has_function_privilege(current_user,
    'devices.fn_insert_mqtt_preparation_secret_if_absent(uuid,uuid,smallint,text,text,text,text)','EXECUTE') AS can_insert_secret,
  has_function_privilege(current_user,
    'devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)','EXECUTE') AS can_reserve,
  has_function_privilege(current_user,
    'devices.fn_claim_mqtt_pairing_preparation(uuid,integer)','EXECUTE') AS can_claim,
  has_function_privilege(current_user,
    'devices.fn_confirm_mqtt_pairing_prepared(uuid,uuid,uuid,text,text,text)','EXECUTE') AS can_confirm,
  has_table_privilege(current_user, 'devices.mqtt_preparation_secret', 'SELECT,INSERT,UPDATE,DELETE') AS secret_dml,
  has_table_privilege(current_user, 'devices.mqtt_pairing_operation', 'SELECT,INSERT,UPDATE,DELETE') AS operation_dml,
  has_table_privilege(current_user, 'devices.mqtt_identity', 'SELECT,INSERT,UPDATE,DELETE') AS identity_dml
FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;

type Privileges = {
  role: string; database: string; inherit: boolean; superuser: boolean;
  bypassrls: boolean; createrole: boolean; createdb: boolean;
  replication: boolean; secret_member: boolean; reserve_member: boolean;
  lease_member: boolean; confirm_member: boolean; membership_count: number;
  can_load: boolean; can_insert_secret: boolean; can_reserve: boolean;
  can_claim: boolean; can_confirm: boolean; secret_dml: boolean;
  operation_dml: boolean; identity_dml: boolean;
};

export function minimalMqttSecretPrivileges(
  value: unknown,
  target: Pick<SecretPgTarget, 'role' | 'database'>,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Partial<Privileges>;
  return v.role === target.role && v.database === target.database &&
    v.inherit === true && v.superuser === false &&
    v.bypassrls === false && v.createrole === false &&
    v.createdb === false && v.replication === false &&
    v.secret_member === true && v.reserve_member === false &&
    v.lease_member === false && v.confirm_member === false &&
    v.membership_count === 1 && v.can_load === true &&
    v.can_insert_secret === true && v.can_reserve === false &&
    v.can_claim === false && v.can_confirm === false &&
    v.secret_dml === false && v.operation_dml === false &&
    v.identity_dml === false;
}

/** Nunca permite consultas arbitrarias ni se reutiliza para otros roles. */
export class MqttSecretPgGateway implements MqttSecretSqlQueryPort, OnModuleDestroy {
  private verified = false;
  constructor(
    private readonly pool: MqttSecretPgPool,
    private readonly target: Pick<SecretPgTarget, 'role' | 'database'>,
  ) {}

  async verifyPrivileges(): Promise<void> {
    this.verified = false;
    let rows: unknown[];
    try {
      const result = await this.pool.query(PRIVILEGES_SQL);
      rows = result.rows;
    } catch {
      throw new Error('MQTT_SECRET_PRIVILEGES_UNVERIFIED');
    }
    if (!Array.isArray(rows) || rows.length !== 1 ||
      !minimalMqttSecretPrivileges(rows[0], this.target)) {
      throw new Error('MQTT_SECRET_PRIVILEGES_UNVERIFIED');
    }
    this.verified = true;
  }

  async query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    if (!this.verified) throw new Error('MQTT_SECRET_NOT_READY');
    if (!allowedMqttSecretQuery(sql, params)) {
      throw new Error('MQTT_SECRET_SQL_NOT_ALLOWED');
    }
    return this.pool.query(sql, params);
  }

  async onModuleDestroy(): Promise<void> {
    this.verified = false;
    await this.pool.end();
  }
}

/** El proveedor opt-in decide el modo; nunca se deriva de una peticion HTTP. */
export async function openMqttSecretPgGateway(
  connectionString: string | undefined,
  mode: MqttSecretConnectionMode,
): Promise<MqttSecretPgGateway> {
  const target = parseMqttSecretConnection(connectionString, mode);
  const pool = new Pool(target.options);
  const gateway = new MqttSecretPgGateway(pool, target);
  try {
    await gateway.verifyPrivileges();
    return gateway;
  } catch {
    await gateway.onModuleDestroy();
    throw new Error('MQTT_SECRET_PRIVILEGES_UNVERIFIED');
  }
}

/** Entrada local anterior: no permitir que pase implicitamente a VPS. */
export async function openMqttSecretDevGateway(
  connectionString: string | undefined,
): Promise<MqttSecretPgGateway> {
  return openMqttSecretPgGateway(connectionString, 'local-dev');
}
