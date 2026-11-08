import type { OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import type { MqttRegistrarQueryClient } from './pg-mqtt-reservation.port';
import { isProductionMqttDatabaseTarget } from './mqtt-production-db-target';

/**
 * Can only be configured for the HU16 reservation account. It never takes
 * DATABASE_URL, the regular Prisma account or Mosquitto credentials.
 */
export type ReserverConnectionMode =
  | 'lab'
  | 'local-dev'
  | 'remote-tls'
  | 'vps-dev-tls'
  | 'production';

export interface ReserverConnectionTarget {
  role: string;
  database: string;
  options: PoolConfig;
}

/**
 * Checks the target BEFORE creating the pool. Reveals no URLs or passwords.
 * URL options are forbidden to prevent overriding TLS through
 * sslmode/sslcert, application_name, etc.
 */
export function parseMqttReserverConnection(
  connectionString: string | undefined,
  mode: ReserverConnectionMode,
  environment: string | undefined = process.env.NODE_ENV,
): ReserverConnectionTarget {
  let url: URL;
  try {
    if (!connectionString) throw new Error();
    url = new URL(connectionString);
  } catch {
    throw new Error('MQTT_RESERVER_DATABASE_URL_INVALID');
  }

  const role = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1));
  const isPortValid = /^\d{1,5}$/.test(url.port) &&
    Number(url.port) > 0 && Number(url.port) <= 65535;

  if (
    url.protocol !== 'postgresql:' || !url.hostname || !isPortValid ||
    !url.password || !/^smarthome_mqtt_reserver_[a-z0-9_]+$/.test(role) ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(database) ||
    url.search !== '' || url.hash !== ''
  ) {
    throw new Error('MQTT_RESERVER_DATABASE_URL_INVALID');
  }

  const lab = mode === 'lab';
  const localDev = mode === 'local-dev';
  const vpsDevTls = mode === 'vps-dev-tls';
  const production = mode === 'production';
  if (localDev && (
    environment !== 'development' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '5432' ||
    database !== 'smarthome' ||
    role !== 'smarthome_mqtt_reserver_dev_login'
  )) {
    throw new Error('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
  }
  if (lab && (
    url.hostname !== '127.0.0.1' || url.port !== '55432' ||
    database !== 'smarthome_test' ||
    role !== 'smarthome_mqtt_reserver_lab_login'
  )) {
    throw new Error('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
  }
  // Only an independent DEV server, without reusing the generic remote mode.
  if (vpsDevTls && (
    environment !== 'production' ||
    url.hostname !== 'smart-home-smarthomepostgresdev-vrmtpz' ||
    url.port !== '5432' ||
    database !== 'smarthome_dev' ||
    role !== 'smarthome_mqtt_reserver_dev_login' ||
    !/^[A-Za-z0-9_-]{43}$/.test(url.password)
  )) {
    throw new Error('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
  }
  if (production && (
    role !== 'smarthome_mqtt_reserver_prod_login' ||
    !/^[A-Za-z0-9_-]{43}$/.test(url.password) ||
    !isProductionMqttDatabaseTarget(url.hostname, database, environment)
  )) {
    throw new Error('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
  }
  if (!lab && !localDev && !vpsDevTls && !production && (
    database === 'smarthome_test' ||
    ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) ||
    role === 'smarthome_mqtt_reserver_lab_login'
  )) {
    throw new Error('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
  }

  return {
    role,
    database,
    options: {
      connectionString,
      // Local mode is only allowed for the exact lab.
      ssl: (lab || localDev) ? false : { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      max: 2,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 4000,
      query_timeout: 5000,
      application_name: 'smarthome_mqtt_reserver',
    },
  };
}

type QueryResponse = { rows: unknown[] };
export interface ReserverPgPool {
  query(sql: string, params?: unknown[]): Promise<QueryResponse>;
  end(): Promise<void>;
}

const VERIFY_PRIVILEGES_SQL = `
SELECT
  current_user::text AS role,
  current_database()::text AS database,
  has_function_privilege(current_user,
    'devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)',
    'EXECUTE') AS can_reserve,
  has_function_privilege(current_user,
    'devices.fn_register_mqtt_identity(uuid,uuid,text)',
    'EXECUTE') AS can_register,
  has_function_privilege(current_user,
    'devices.fn_claim_mqtt_revocation()',
    'EXECUTE') AS can_revoke,
  has_table_privilege(current_user,
    'devices.mqtt_pairing_operation', 'SELECT') AS can_read_operation,
  has_table_privilege(current_user,
    'devices.mqtt_identity', 'SELECT') AS can_read_identity,
  pg_has_role(current_user, 'smarthome_mqtt_registrar', 'MEMBER') AS registrar_member,
  pg_has_role(current_user, 'smarthome_mqtt_revoke', 'MEMBER') AS revoke_member,
  r.rolsuper AS is_superuser,
  r.rolbypassrls AS bypass_rls,
  r.rolcreaterole AS can_create_role,
  r.rolcreatedb AS can_create_db
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
`;

interface PrivilegeRow {
  role: string;
  database: string;
  can_reserve: boolean;
  can_register: boolean;
  can_revoke: boolean;
  can_read_operation: boolean;
  can_read_identity: boolean;
  registrar_member: boolean;
  revoke_member: boolean;
  is_superuser: boolean;
  bypass_rls: boolean;
  can_create_role: boolean;
  can_create_db: boolean;
}

function isMinimalPrivilegeRow(row: unknown, target: Pick<ReserverConnectionTarget, 'role' | 'database'>): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Partial<PrivilegeRow>;
  return r.role === target.role && r.database === target.database &&
    r.can_reserve === true &&
    r.can_register === false && r.can_revoke === false &&
    r.can_read_operation === false && r.can_read_identity === false &&
    r.registrar_member === false && r.revoke_member === false &&
    r.is_superuser === false && r.bypass_rls === false &&
    r.can_create_role === false && r.can_create_db === false;
}

/**
 * Queries only when the privileges have been verified. This class is NOT
 * injected automatically: register it with an async factory when HU16
 * has persistent transitions and the migration is installed on the target.
 */
export class MqttReserverPgGateway
  implements MqttRegistrarQueryClient, OnModuleDestroy {
  private verified = false;

  constructor(
    private readonly pool: ReserverPgPool,
    private readonly target: Pick<ReserverConnectionTarget, 'role' | 'database'>,
  ) {}

  async verifyPrivileges(): Promise<void> {
    this.verified = false;
    let response: QueryResponse;
    try {
      response = await this.pool.query(VERIFY_PRIVILEGES_SQL);
    } catch {
      throw new Error('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
    }
    if (!Array.isArray(response.rows) || response.rows.length !== 1 ||
      !isMinimalPrivilegeRow(response.rows[0], this.target)) {
      throw new Error('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
    }
    this.verified = true;
  }

  async query(sql: string, parameters: unknown[]): Promise<QueryResponse> {
    if (!this.verified) throw new Error('MQTT_RESERVER_NOT_READY');
    // Do not widen to generic DML APIs: the adapter only has the PostgreSQL
    // EXECUTE permission to reserve.
    return this.pool.query(sql, parameters);
  }

  async onModuleDestroy(): Promise<void> {
    this.verified = false;
    await this.pool.end();
  }
}

/**
 * Opt-in factory; fails closed and destroys the pool if it cannot verify permissions.
 * Do NOT run it at normal startup yet; do not register it in DevicesModule.
 */
export async function openMqttReserverPgGateway(
  connectionString: string | undefined,
  mode: ReserverConnectionMode,
): Promise<MqttReserverPgGateway> {
  const target = parseMqttReserverConnection(connectionString, mode);
  const pool = new Pool(target.options);
  const gateway = new MqttReserverPgGateway(pool, target);
  try {
    await gateway.verifyPrivileges();
    return gateway;
  } catch {
    await gateway.onModuleDestroy();
    throw new Error('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
  }
}
