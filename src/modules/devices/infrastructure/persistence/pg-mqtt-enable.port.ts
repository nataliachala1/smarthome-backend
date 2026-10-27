import { createHash } from 'node:crypto';
import type { MqttWorkerPgGateway } from './mqtt-worker-pg.gateway';
import type { MqttEnablePort, MqttEnableClaim } from '../../application/services/shelly-mqtt-enable.coordinator';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME = /^[A-Za-z0-9_-]{1,128}$/;
const REQUEST = `SELECT devices.fn_request_mqtt_enable($1::uuid,$2::uuid,$3::text) AS requested`;
const CLAIM = `SELECT operation_id::text AS "operationId", lease_token::text AS "leaseToken",
  lease_until AS "leaseUntil", identity_id::text AS "identityId",
  username, client_id AS "clientId", role_name AS "roleName"
  FROM devices.fn_claim_mqtt_enable($1::uuid,$2::integer)`;
const CONFIRM = `SELECT devices.fn_confirm_mqtt_enabled($1::uuid,$2::uuid,$3::text,$4::text,$5::text) AS confirmed`;
const UNCERTAIN = `SELECT devices.fn_report_mqtt_pairing_uncertain(
           $1::uuid, $2::uuid, $3::text
         ) AS reported`;

export class PgMqttEnablePort implements MqttEnablePort {
  constructor(private readonly db: Pick<MqttWorkerPgGateway,'query'>) {}

  async request(operationId: string, actorId: string, sessionToken: string): Promise<void> {
    if (!UUID.test(operationId) || !UUID.test(actorId) ||
        typeof sessionToken !== 'string' || !/^[a-f0-9]{64}$/.test(sessionToken)) {
      throw new Error('MQTT_ENABLE_REQUEST_INVALID');
    }
    const sha = createHash('sha256').update(sessionToken,'utf8').digest('hex');
    const answer = await this.db.query(REQUEST,[operationId,actorId,sha]);
    if (answer.rows.length !== 1 || (answer.rows[0] as {requested?:unknown})?.requested !== true) {
      throw new Error('MQTT_ENABLE_REQUEST_UNCERTAIN');
    }
  }

  async claim(operationId: string): Promise<MqttEnableClaim> {
    if (!UUID.test(operationId)) throw new Error('MQTT_ENABLE_OPERATION_INVALID');
    const answer = await this.db.query(CLAIM,[operationId,60]);
    if (answer.rows.length !== 1) throw new Error('MQTT_ENABLE_CLAIM_UNCERTAIN');
    const r = answer.rows[0] as Record<string,unknown>;
    if (r.operationId !== operationId || !UUID.test(String(r.leaseToken)) ||
        !UUID.test(String(r.identityId)) || !NAME.test(String(r.username)) ||
        !NAME.test(String(r.clientId)) || !NAME.test(String(r.roleName)) ||
        !Number.isFinite(new Date(String(r.leaseUntil)).getTime()) ||
        new Date(String(r.leaseUntil)).getTime() <= Date.now()) {
      throw new Error('MQTT_ENABLE_CLAIM_INVALID');
    }
    return {
      operationId, leaseToken:String(r.leaseToken), identityId:String(r.identityId),
      username:String(r.username),clientId:String(r.clientId),roleName:String(r.roleName),
      leaseUntil:new Date(String(r.leaseUntil)),
    };
  }

  async confirm(claim: MqttEnableClaim): Promise<void> {
    const result = await this.db.query(CONFIRM,[claim.operationId,claim.leaseToken,
      claim.username,claim.clientId,claim.roleName]);
    if (result.rows.length !== 1 || (result.rows[0] as {confirmed?:unknown})?.confirmed !== true) {
      throw new Error('MQTT_ENABLE_CONFIRM_UNCERTAIN');
    }
  }

  async uncertain(claim: MqttEnableClaim): Promise<void> {
    const result = await this.db.query(UNCERTAIN,[claim.operationId,claim.leaseToken,
      'MQTT_ADMIN_OUTCOME_UNKNOWN']);
    if (result.rows.length !== 1 || (result.rows[0] as {reported?:unknown})?.reported !== true) {
      throw new Error('MQTT_ENABLE_QUARANTINE_UNCONFIRMED');
    }
  }
}
