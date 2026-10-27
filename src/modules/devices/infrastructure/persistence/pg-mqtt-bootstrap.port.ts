import type { MqttAuthorizedBootstrapPort, MqttAuthorizedBootstrapEnvelope } from '../../application/services/shelly-mqtt-bootstrap.action';
import type { MqttSecretPgGateway } from './mqtt-secret-pg.gateway';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
export const MQTT_BOOTSTRAP_ENVELOPE_SQL=`SELECT operation_id AS "operationId", identity_id AS "identityId", manufacturer_device_id AS "manufacturerDeviceId",
  broker_username AS "username", broker_client_id AS "clientId", topic_scope AS "topicScope",
  format_version AS "formatVersion", key_id AS "keyId", nonce, ciphertext, auth_tag AS "authTag",
  expires_at AS "expiresAt"
  FROM devices.fn_get_authorized_mqtt_bootstrap($1::uuid,$2::uuid,$3::text)`;
export class PgMqttBootstrapPort implements MqttAuthorizedBootstrapPort {
  constructor(private readonly db:Pick<MqttSecretPgGateway,'query'>) {}
  async load(operationId:string,actorId:string,tokenHash:string):Promise<MqttAuthorizedBootstrapEnvelope> {
    if (!UUID.test(operationId) || !UUID.test(actorId) || !SHA.test(tokenHash)) {
      throw new Error('MQTT_BOOTSTRAP_PORT_ARGUMENTS_INVALID');
    }
    const result=await this.db.query(MQTT_BOOTSTRAP_ENVELOPE_SQL,[operationId,actorId,tokenHash]);
    if (!Array.isArray(result.rows) || result.rows.length!==1 ||
        result.rows[0]===null || typeof result.rows[0]!=='object') {
      throw new Error('MQTT_BOOTSTRAP_PORT_RESULT_INVALID');
    }
    return result.rows[0] as MqttAuthorizedBootstrapEnvelope;
  }
}
