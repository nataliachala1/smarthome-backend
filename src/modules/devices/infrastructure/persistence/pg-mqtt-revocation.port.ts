import type {
  MqttRevocationClaim,
  MqttRevocationEvidence,
  MqttRevocationFailure,
  MqttRevocationFinishResult,
  MqttRevocationStore,
} from '../../application/services/mqtt-revocation.worker';
import type { MqttRevocationQueryClient } from './mqtt-revocation-pg.gateway';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME = /^[A-Za-z0-9_-]{1,128}$/;

const SQL = {
  claimPairing: `SELECT operation_id::text AS "operationId", lease_token::text AS "leaseToken",
      lease_until AS "leaseUntil", identity_id::text AS "identityId",
      username, client_id AS "clientId", role_name AS "roleName",
      attempt, revocation_probe_at AS "revocationProbeAt"
      FROM devices.fn_claim_mqtt_pairing_revocation($1::integer)`,
  finishPairing: `SELECT devices.fn_finish_mqtt_pairing_revocation(
      $1::uuid,$2::uuid,$3::text,$4::text) AS finished`,
  claimIdentity: `SELECT identity_id::text AS "identityId",claim_token::text AS "leaseToken",
      attempt,operation_id::text AS "operationId",
      revocation_probe_at AS "revocationProbeAt",
      broker_username AS username,broker_client_id AS "clientId",
      broker_role_name AS "roleName"
      FROM devices.fn_claim_mqtt_revocation_with_binding()`,
  finishIdentity: `SELECT devices.fn_finish_mqtt_revocation_evidenced(
      $1::uuid,$2::uuid,$3::text,$4::text) AS finished`,
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value);
}

function readDate(value: unknown): Date | null {
  const date = value instanceof Date ? value :
    typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export class PgMqttRevocationPort implements MqttRevocationStore {
  constructor(private readonly db: MqttRevocationQueryClient) {}

  async claim(): Promise<MqttRevocationClaim | null> {
    const pairing = await this.claimPairing();
    if (pairing) return pairing;
    return this.claimRegisteredIdentity();
  }

  private async claimPairing(): Promise<MqttRevocationClaim | null> {
    const result = await this.db.query(SQL.claimPairing, [60]);
    if (!Array.isArray(result.rows) || result.rows.length > 1) {
      throw new Error('MQTT_REVOCATION_CLAIM_INVALID');
    }
    if (!result.rows.length) return null;
    const row = result.rows[0];
    const leaseUntil = isObject(row) ? readDate(row.leaseUntil) : null;
    const revocationProbeAt = isObject(row) && row.revocationProbeAt !== null
      ? readDate(row.revocationProbeAt) : null;
    if (!isObject(row) || !isUuid(row.operationId) || !isUuid(row.leaseToken) ||
        !isUuid(row.identityId) || !isName(row.username) ||
        !isName(row.clientId) || !isName(row.roleName) || !leaseUntil ||
        leaseUntil.getTime() <= Date.now() || leaseUntil.getTime() > Date.now() + 120_000 ||
        !Number.isInteger(row.attempt) || (row.attempt as number) < 1 ||
        (row.revocationProbeAt !== null && !revocationProbeAt)) {
      throw new Error('MQTT_REVOCATION_CLAIM_INVALID');
    }
    return {
      identityId: row.identityId,
      claimToken: row.leaseToken,
      attempt: row.attempt as number,
      source: 'pairing-operation',
      operationId: row.operationId,
      username: row.username,
      clientId: row.clientId,
      roleName: row.roleName,
      revocationProbeAt,
    };
  }

  private async claimRegisteredIdentity(): Promise<MqttRevocationClaim | null> {
    const result = await this.db.query(SQL.claimIdentity, []);
    if (!Array.isArray(result.rows) || result.rows.length > 1) {
      throw new Error('MQTT_REVOCATION_CLAIM_INVALID');
    }
    if (!result.rows.length) return null;
    const row = result.rows[0];
    const revocationProbeAt = isObject(row) && row.revocationProbeAt !== null
      ? readDate(row.revocationProbeAt) : null;
    if (!isObject(row) || !isUuid(row.identityId) || !isUuid(row.leaseToken) ||
        !Number.isInteger(row.attempt) || (row.attempt as number) < 1 ||
        !isName(row.username) ||
        !(row.clientId === null || isName(row.clientId)) ||
        !(row.roleName === null || isName(row.roleName)) ||
        ((row.clientId === null) !== (row.roleName === null)) ||
        !(row.operationId === null || isUuid(row.operationId)) ||
        (row.revocationProbeAt !== null && !revocationProbeAt) ||
        (row.operationId === null && revocationProbeAt !== null)) {
      throw new Error('MQTT_REVOCATION_CLAIM_INVALID');
    }
    return {
      identityId: row.identityId,
      claimToken: row.leaseToken,
      attempt: row.attempt as number,
      source: 'registered-identity',
      ...(typeof row.operationId === 'string' ? { operationId: row.operationId } : {}),
      username: row.username,
      clientId: row.clientId,
      roleName: row.roleName,
      revocationProbeAt,
    };
  }

  async finish(
    claim: MqttRevocationClaim,
    error: MqttRevocationFailure | null,
    evidence?: MqttRevocationEvidence,
  ): Promise<MqttRevocationFinishResult> {
    if (error === null && !evidence) {
      throw new Error('MQTT_REVOCATION_EVIDENCE_REQUIRED');
    }
    let rows: unknown[];
    if (claim.source === 'pairing-operation' && claim.operationId) {
      const result = await this.db.query(SQL.finishPairing, [
        claim.operationId, claim.claimToken, evidence ?? null, error,
      ]);
      rows = result.rows;
    } else if (claim.source === 'registered-identity') {
      const result = await this.db.query(SQL.finishIdentity, [
        claim.identityId, claim.claimToken, error, evidence ?? null,
      ]);
      rows = result.rows;
    } else {
      throw new Error('MQTT_REVOCATION_CLAIM_INVALID');
    }
    if (!Array.isArray(rows) || rows.length !== 1 || !isObject(rows[0]) ||
        ![true, false, 'REVOKED', 'RETRY_SCHEDULED', 'LEASE_LOST']
          .includes(rows[0].finished as boolean | string)) {
      throw new Error('MQTT_REVOCATION_FINISH_INVALID');
    }
    return rows[0].finished as MqttRevocationFinishResult;
  }
}
