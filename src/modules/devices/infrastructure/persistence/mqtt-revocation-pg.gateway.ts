import type { OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';

export type MqttRevocationConnectionMode = 'local-dev' | 'vps-dev-tls';

export interface MqttRevocationConnectionTarget {
  readonly role: string;
  readonly database: string;
  readonly options: PoolConfig;
}

const VPS_DEV_HOST = 'smart-home-smarthomepostgresdev-vrmtpz';
const REVOKE_LOGIN = 'smarthome_mqtt_revoke_dev_login';

export function parseMqttRevocationConnection(
  connectionString: string | undefined,
  mode: MqttRevocationConnectionMode,
  environment: string | undefined = process.env.NODE_ENV,
): MqttRevocationConnectionTarget {
  let url: URL;
  try {
    if (!connectionString) throw new Error();
    url = new URL(connectionString);
  } catch {
    throw new Error('MQTT_REVOCATION_DATABASE_URL_INVALID');
  }

  const role = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1));
  const portValid = /^\d{1,5}$/.test(url.port) &&
    Number(url.port) > 0 && Number(url.port) <= 65535;
  if (url.protocol !== 'postgresql:' || !url.hostname || !portValid ||
      role !== REVOKE_LOGIN || !url.password ||
      !/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(database) ||
      url.search || url.hash) {
    throw new Error('MQTT_REVOCATION_DATABASE_URL_INVALID');
  }

  if (mode === 'local-dev' && (
    environment !== 'development' || url.hostname !== '127.0.0.1' ||
    url.port !== '5432' || database !== 'smarthome'
  )) {
    throw new Error('MQTT_REVOCATION_DATABASE_TARGET_NOT_ALLOWED');
  }
  if (mode === 'vps-dev-tls' && (
    environment !== 'production' || url.hostname !== VPS_DEV_HOST ||
    url.port !== '5432' || database !== 'smarthome_dev' ||
    !/^[A-Za-z0-9_-]{43}$/.test(url.password)
  )) {
    throw new Error('MQTT_REVOCATION_DATABASE_TARGET_NOT_ALLOWED');
  }
  if (!['local-dev', 'vps-dev-tls'].includes(mode)) {
    throw new Error('MQTT_REVOCATION_DATABASE_TARGET_NOT_ALLOWED');
  }

  return {
    role,
    database,
    options: {
      connectionString,
      ssl: mode === 'local-dev'
        ? false
        : { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      max: 2,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 4000,
      query_timeout: 5000,
      application_name: 'smarthome_mqtt_revoke',
    },
  };
}

type QueryResponse = { rows: unknown[] };

export interface MqttRevocationPgPool {
  query(sql: string, parameters?: unknown[]): Promise<QueryResponse>;
  end(): Promise<void>;
}

export type MqttRevocationQueryClient = Pick<MqttRevocationPgPool, 'query'>;

const ALLOWED_SQL = [
  {
    sql: `SELECT operation_id::text AS "operationId", lease_token::text AS "leaseToken",
      lease_until AS "leaseUntil", identity_id::text AS "identityId",
      username, client_id AS "clientId", role_name AS "roleName",
      attempt, revocation_probe_at AS "revocationProbeAt"
      FROM devices.fn_claim_mqtt_pairing_revocation($1::integer)`,
    parameters: 1,
  },
  {
    sql: `SELECT devices.fn_finish_mqtt_pairing_revocation(
      $1::uuid,$2::uuid,$3::text,$4::text) AS finished`,
    parameters: 4,
  },
  {
    sql: `SELECT identity_id::text AS "identityId",claim_token::text AS "leaseToken",
      attempt,operation_id::text AS "operationId",
      revocation_probe_at AS "revocationProbeAt",
      broker_username AS username,broker_client_id AS "clientId",
      broker_role_name AS "roleName"
      FROM devices.fn_claim_mqtt_revocation_with_binding()`,
    parameters: 0,
  },
  {
    sql: `SELECT devices.fn_finish_mqtt_revocation_evidenced(
      $1::uuid,$2::uuid,$3::text,$4::text) AS finished`,
    parameters: 4,
  },
] as const;

function canonical(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export function isAllowedMqttRevocationQuery(
  sql: unknown,
  parameters: unknown,
): boolean {
  if (typeof sql !== 'string' || !Array.isArray(parameters)) return false;
  return ALLOWED_SQL.some((entry) => canonical(sql) === canonical(entry.sql) &&
    parameters.length === entry.parameters);
}

const PRIVILEGE_SQL = `
SELECT current_user::text AS role,current_database()::text AS database,
  pg_has_role(current_user,'smarthome_mqtt_revoke','MEMBER') AS revoke_member,
  pg_has_role(current_user,'smarthome_mqtt_registrar','MEMBER') AS registrar_member,
  pg_has_role(current_user,'smarthome_mqtt_lease_worker','MEMBER') AS lease_member,
  pg_has_role(current_user,'smarthome_mqtt_reserver','MEMBER') AS reserver_member,
  pg_has_role(current_user,'smarthome_mqtt_secret_worker','MEMBER') AS secret_member,
  pg_has_role(current_user,'smarthome_mqtt_rpc_worker','MEMBER') AS rpc_member,
  pg_has_role(current_user,'smarthome_mqtt_auth_confirmer','MEMBER') AS auth_member,
  pg_has_role(current_user,'smarthome_runtime_app','MEMBER') AS runtime_member,
  has_function_privilege(current_user,'devices.fn_claim_mqtt_pairing_revocation(integer)','EXECUTE') AS can_claim_pairing,
  has_function_privilege(current_user,'devices.fn_finish_mqtt_pairing_revocation(uuid,uuid,text,text)','EXECUTE') AS can_finish_pairing,
  has_function_privilege(current_user,'devices.fn_claim_mqtt_revocation_with_binding()','EXECUTE') AS can_claim_identity,
  has_function_privilege(current_user,'devices.fn_finish_mqtt_revocation_evidenced(uuid,uuid,text,text)','EXECUTE') AS can_finish_identity,
  has_function_privilege(current_user,'devices.fn_claim_mqtt_revocation()','EXECUTE') AS can_claim_legacy_identity,
  has_function_privilege(current_user,'devices.fn_finish_mqtt_revocation(uuid,uuid,text)','EXECUTE') AS can_finish_legacy_identity,
  has_function_privilege(current_user,'devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)','EXECUTE') AS can_reserve,
  has_function_privilege(current_user,'devices.fn_register_mqtt_identity(uuid,uuid,text)','EXECUTE') AS can_register,
  has_table_privilege(current_user,'devices.mqtt_pairing_operation','SELECT,INSERT,UPDATE,DELETE') AS operation_dml,
  has_table_privilege(current_user,'devices.mqtt_identity','SELECT,INSERT,UPDATE,DELETE') AS identity_dml,
  has_table_privilege(current_user,'devices.mqtt_pairing_revocation_attestation','SELECT,INSERT,UPDATE,DELETE') AS evidence_dml,
  has_table_privilege(current_user,'devices.mqtt_preparation_secret','SELECT,INSERT,UPDATE,DELETE') AS secret_dml,
  has_table_privilege(current_user,'devices.mqtt_rpc_challenge','SELECT,INSERT,UPDATE,DELETE') AS rpc_dml,
  has_table_privilege(current_user,'devices.mqtt_pairing_state_event','SELECT,INSERT,UPDATE,DELETE') AS state_event_dml,
  has_table_privilege(current_user,'devices.mqtt_broker_auth_attestation','SELECT,INSERT,UPDATE,DELETE') AS auth_evidence_dml,
  has_table_privilege(current_user,'devices.device_pairing_session','SELECT,INSERT,UPDATE,DELETE') AS session_dml,
  has_table_privilege(current_user,'devices.device','SELECT,INSERT,UPDATE,DELETE') AS device_dml,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname NOT IN (current_user,'smarthome_mqtt_revoke')
      AND pg_has_role(current_user,r.oid,'MEMBER')) AS isolated_membership,
  r.rolsuper AS is_superuser,r.rolbypassrls AS bypass_rls,
  r.rolcreaterole AS can_create_role,r.rolcreatedb AS can_create_db,
  r.rolreplication AS can_replicate,
  has_schema_privilege(current_user,'devices','CREATE') AS can_create_schema,
  has_database_privilege(current_user,current_database(),'CREATE') AS can_create_objects
FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;

interface PrivilegeRow {
  role: string;
  database: string;
  revoke_member: boolean;
  registrar_member: boolean;
  lease_member: boolean;
  reserver_member: boolean;
  secret_member: boolean;
  rpc_member: boolean;
  auth_member: boolean;
  runtime_member: boolean;
  can_claim_pairing: boolean;
  can_finish_pairing: boolean;
  can_claim_identity: boolean;
  can_finish_identity: boolean;
  can_claim_legacy_identity: boolean;
  can_finish_legacy_identity: boolean;
  can_reserve: boolean;
  can_register: boolean;
  operation_dml: boolean;
  identity_dml: boolean;
  evidence_dml: boolean;
  secret_dml: boolean;
  rpc_dml: boolean;
  state_event_dml: boolean;
  auth_evidence_dml: boolean;
  session_dml: boolean;
  device_dml: boolean;
  isolated_membership: boolean;
  is_superuser: boolean;
  bypass_rls: boolean;
  can_create_role: boolean;
  can_create_db: boolean;
  can_replicate: boolean;
  can_create_schema: boolean;
  can_create_objects: boolean;
}

export class MqttRevocationPgGateway
  implements MqttRevocationQueryClient, OnModuleDestroy {
  private verified = false;

  constructor(
    private readonly pool: MqttRevocationPgPool,
    private readonly target: Pick<MqttRevocationConnectionTarget, 'role' | 'database'>,
  ) {}

  async verifyPrivileges(): Promise<void> {
    this.verified = false;
    let response: QueryResponse;
    try {
      response = await this.pool.query(PRIVILEGE_SQL);
    } catch {
      throw new Error('MQTT_REVOCATION_PRIVILEGES_UNVERIFIED');
    }
    const row = response.rows?.length === 1
      ? response.rows[0] as Partial<PrivilegeRow>
      : null;
    if (!row || row.role !== this.target.role || row.database !== this.target.database ||
        row.revoke_member !== true || row.can_claim_pairing !== true ||
        row.can_finish_pairing !== true || row.can_claim_identity !== true ||
        row.can_finish_identity !== true || row.can_claim_legacy_identity !== false ||
        row.can_finish_legacy_identity !== false || row.can_reserve !== false ||
        row.can_register !== false || row.registrar_member !== false ||
        row.lease_member !== false || row.reserver_member !== false ||
        row.secret_member !== false || row.rpc_member !== false ||
        row.auth_member !== false || row.runtime_member !== false ||
        row.operation_dml !== false || row.identity_dml !== false ||
        row.evidence_dml !== false || row.secret_dml !== false ||
        row.rpc_dml !== false || row.state_event_dml !== false ||
        row.auth_evidence_dml !== false || row.session_dml !== false ||
        row.device_dml !== false || row.isolated_membership !== true ||
        row.is_superuser !== false || row.bypass_rls !== false ||
        row.can_create_role !== false || row.can_create_db !== false) {
      throw new Error('MQTT_REVOCATION_PRIVILEGES_UNVERIFIED');
    }
    if (!row || row.can_replicate !== false || row.can_create_schema !== false ||
        row.can_create_objects !== false) {
      throw new Error('MQTT_REVOCATION_PRIVILEGES_UNVERIFIED');
    }
    this.verified = true;
  }

  async query(sql: string, parameters: unknown[] = []): Promise<QueryResponse> {
    if (!this.verified) throw new Error('MQTT_REVOCATION_NOT_READY');
    if (!isAllowedMqttRevocationQuery(sql, parameters)) {
      throw new Error('MQTT_REVOCATION_QUERY_REJECTED');
    }
    return this.pool.query(sql, parameters);
  }

  async onModuleDestroy(): Promise<void> {
    this.verified = false;
    await this.pool.end();
  }
}

export async function openMqttRevocationPgGateway(
  connectionString: string | undefined,
  mode: MqttRevocationConnectionMode,
): Promise<MqttRevocationPgGateway> {
  const target = parseMqttRevocationConnection(connectionString, mode);
  const pool = new Pool(target.options);
  const gateway = new MqttRevocationPgGateway(pool, target);
  try {
    await gateway.verifyPrivileges();
    return gateway;
  } catch {
    await gateway.onModuleDestroy();
    throw new Error('MQTT_REVOCATION_PRIVILEGES_UNVERIFIED');
  }
}
