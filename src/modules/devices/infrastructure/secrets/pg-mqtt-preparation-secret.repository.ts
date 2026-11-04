import type {
  EncryptedMqttPreparationSecretRecord,
  MqttPreparationSecretRepository,
} from './encrypted-mqtt-preparation-secret.port';

/**
 * Puerto SQL deliberadamente estrecho; conectar SOLO con el login especializado
 * de secretos y previa verificacion de privilegios del futuro gateway 503.28.
 * No se registra en DevicesModule.
 */
export interface MqttSecretSqlQueryPort {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEASE_TOKEN = OPERATION_ID;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const LOAD_SQL = `SELECT operation_id, format_version, key_id, nonce,
  ciphertext, auth_tag
FROM devices.fn_load_mqtt_preparation_secret($1::uuid, $2::uuid)`;

const INSERT_SQL = `SELECT devices.fn_insert_mqtt_preparation_secret_if_absent(
  $1::uuid, $2::uuid, $3::smallint, $4::text, $5::text, $6::text, $7::text
) AS inserted`;

function validOperationId(id: unknown): id is string {
  return typeof id === 'string' && OPERATION_ID.test(id);
}

function validEncoding(s: unknown, size: number): s is string {
  return typeof s === 'string' && s.length === size && BASE64URL.test(s);
}

function validRecord(r: unknown): r is EncryptedMqttPreparationSecretRecord {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const v = r as Record<string, unknown>;
  return validOperationId(v.operationId) && v.formatVersion === 1 &&
    typeof v.keyId === 'string' && KEY_ID.test(v.keyId) &&
    validEncoding(v.nonce, 16) && validEncoding(v.ciphertext, 58) &&
    validEncoding(v.authTag, 22);
}

/**
 * PostgreSQL adapter for the AES-GCM engine (503.26).
 * Only SECURITY DEFINER functions are callable; NO direct table CRUD.
 * SQL exceptions are intentionally opaque to consumers. Engine wraps errors.
 */
export class PgMqttPreparationSecretRepository implements MqttPreparationSecretRepository {
  constructor(private readonly db: MqttSecretSqlQueryPort) {
    if (!db || typeof db.query !== 'function') {
      throw new Error('MQTT_SECRET_SQL_CLIENT_INVALID');
    }
  }

  async load(operationId: string, leaseToken: string): Promise<EncryptedMqttPreparationSecretRecord | null> {
    if (!validOperationId(operationId)) throw new Error('MQTT_SECRET_OPERATION_INVALID');
    if (typeof leaseToken !== 'string' || !LEASE_TOKEN.test(leaseToken)) {
      throw new Error('MQTT_SECRET_LEASE_INVALID');
    }
    const answer = await this.db.query(LOAD_SQL, [operationId, leaseToken]);
    if (!answer || !Array.isArray(answer.rows) || answer.rows.length > 1) {
      throw new Error('MQTT_SECRET_SQL_REPLY_INVALID');
    }
    if (answer.rows.length === 0) return null;
    const row = answer.rows[0];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('MQTT_SECRET_SQL_REPLY_INVALID');
    }
    const r = row as Record<string, unknown>;
    const record = {
      operationId: r.operation_id,
      formatVersion: r.format_version,
      keyId: r.key_id,
      nonce: r.nonce,
      ciphertext: r.ciphertext,
      authTag: r.auth_tag,
    };
    if (!validRecord(record) || record.operationId !== operationId) {
      throw new Error('MQTT_SECRET_SQL_REPLY_INVALID');
    }
    return record;
  }

  async insertIfAbsent(record: EncryptedMqttPreparationSecretRecord, leaseToken: string): Promise<boolean> {
    if (!validRecord(record)) throw new Error('MQTT_SECRET_RECORD_INVALID');
    if (typeof leaseToken !== 'string' || !LEASE_TOKEN.test(leaseToken)) {
      throw new Error('MQTT_SECRET_LEASE_INVALID');
    }
    const args = [record.operationId, leaseToken, record.formatVersion, record.keyId,
      record.nonce, record.ciphertext, record.authTag];
    const answer = await this.db.query(INSERT_SQL, args);
    if (!answer || !Array.isArray(answer.rows) || answer.rows.length !== 1 ||
        !answer.rows[0] || typeof answer.rows[0] !== 'object' ||
        Array.isArray(answer.rows[0])) {
      throw new Error('MQTT_SECRET_SQL_REPLY_INVALID');
    }
    const flag = (answer.rows[0] as Record<string, unknown>).inserted;
    if (typeof flag !== 'boolean') throw new Error('MQTT_SECRET_SQL_REPLY_INVALID');
    return flag;
  }
}
