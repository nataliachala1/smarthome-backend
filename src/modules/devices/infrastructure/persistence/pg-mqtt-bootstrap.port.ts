import type {
  MqttAuthorizedBootstrapEnvelope,
  MqttAuthorizedBootstrapPort,
} from '../../application/services/shelly-mqtt-bootstrap.action';
import type { MqttSecretPgGateway } from './mqtt-secret-pg.gateway';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const NAME = /^[A-Za-z0-9_-]{1,128}$/;

function validEncoded(value: unknown, bytes: number): value is string {
  if (typeof value !== 'string' || !BASE64URL.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === bytes && decoded.toString('base64url') === value;
}

export const MQTT_BOOTSTRAP_ENVELOPE_SQL = `SELECT
  operation_id AS "operationId", identity_id AS "identityId",
  manufacturer_device_id AS "manufacturerDeviceId",
  broker_username AS "username", broker_client_id AS "clientId",
  topic_scope AS "topicScope", format_version AS "formatVersion",
  key_id AS "keyId", nonce, ciphertext, auth_tag AS "authTag",
  expires_at AS "expiresAt"
FROM devices.fn_get_authorized_mqtt_bootstrap($1::uuid,$2::uuid,$3::text)`;

function validEnvelope(value: unknown, expectedOperationId: string):
  value is MqttAuthorizedBootstrapEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const expiryValid = row.expiresAt instanceof Date ||
    (typeof row.expiresAt === 'string' &&
      Number.isFinite(Date.parse(row.expiresAt)));
  return row.operationId === expectedOperationId &&
    typeof row.identityId === 'string' && UUID_V4.test(row.identityId) &&
    typeof row.manufacturerDeviceId === 'string' &&
    /^shelly[a-z0-9_-]{1,94}$/.test(row.manufacturerDeviceId) &&
    typeof row.username === 'string' && NAME.test(row.username) &&
    typeof row.clientId === 'string' && NAME.test(row.clientId) &&
    typeof row.topicScope === 'string' && row.topicScope.length > 0 &&
    row.topicScope.length <= 256 && row.formatVersion === 1 &&
    typeof row.keyId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(row.keyId) &&
    validEncoded(row.nonce, 12) && validEncoded(row.ciphertext, 43) &&
    validEncoded(row.authTag, 16) &&
    expiryValid;
}

export class PgMqttBootstrapPort implements MqttAuthorizedBootstrapPort {
  constructor(private readonly db: Pick<MqttSecretPgGateway, 'query'>) {}

  async load(
    operationId: string,
    actorId: string,
    tokenHash: string,
  ): Promise<MqttAuthorizedBootstrapEnvelope> {
    if (!UUID_V4.test(operationId) || !UUID_V4.test(actorId) ||
        !SHA.test(tokenHash)) {
      throw new Error('MQTT_BOOTSTRAP_PORT_ARGUMENTS_INVALID');
    }
    const result = await this.db.query(
      MQTT_BOOTSTRAP_ENVELOPE_SQL,
      [operationId, actorId, tokenHash],
    );
    if (!Array.isArray(result.rows) || result.rows.length !== 1 ||
        !validEnvelope(result.rows[0], operationId)) {
      throw new Error('MQTT_BOOTSTRAP_PORT_RESULT_INVALID');
    }
    return result.rows[0];
  }
}
