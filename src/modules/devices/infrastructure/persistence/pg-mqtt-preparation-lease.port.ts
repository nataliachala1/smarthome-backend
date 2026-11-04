import type {
  MqttPreparationLeasePort,
  PreparationLeaseClaim,
} from '../../application/services/shelly-mqtt-preparation.coordinator';

/** Cliente SQL exclusivamente autenticado como worker de leases (025). */
export interface MqttLeaseQueryClient {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_RESULT_CODE = 'MQTT_ADMIN_OUTCOME_UNKNOWN';

function validUuid(value: string): boolean {
  return typeof value === 'string' && UUID_V4.test(value);
}

/** No puede declarar éxito de broker; solo claim y cuarentena (025). */
export class PgMqttPreparationLeasePort implements MqttPreparationLeasePort {
  constructor(private readonly leaseWorker: MqttLeaseQueryClient) {}

  async claim(operationId: string, leaseSeconds: number): Promise<PreparationLeaseClaim> {
    if (!validUuid(operationId) || !Number.isInteger(leaseSeconds) ||
        leaseSeconds < 1 || leaseSeconds > 300) {
      throw new Error('MQTT_LEASE_CLAIM_INPUT_INVALID');
    }
    let rows: unknown[];
    try {
      const result = await this.leaseWorker.query(
        `SELECT operation_id::text AS "operationId",
                assigned_token::text AS "leaseToken",
                expires_at AS "expiresAt",
                attempt_number AS "attemptNumber"
         FROM devices.fn_claim_mqtt_pairing_preparation($1::uuid, $2::integer)`,
        [operationId, leaseSeconds],
      );
      rows = result.rows;
    } catch {
      // La llamada podria haber hecho COMMIT aun cuando el cliente perdio la respuesta.
      // No reclamar otro lease a ciegas; el worker superior debe reconciliar.
      throw new Error('MQTT_LEASE_CLAIM_OUTCOME_UNKNOWN');
    }
    if (!Array.isArray(rows) || rows.length !== 1 ||
        !rows[0] || typeof rows[0] !== 'object') {
      throw new Error('MQTT_LEASE_CLAIM_RESPONSE_INVALID');
    }
    const row = rows[0] as Record<string, unknown>;
    const expiry = row.expiresAt instanceof Date
      ? row.expiresAt
      : typeof row.expiresAt === 'string' ? new Date(row.expiresAt) : null;
    if (row.operationId !== operationId || !validUuid(row.leaseToken as string) ||
        !Number.isInteger(row.attemptNumber) || (row.attemptNumber as number) < 1 ||
        !expiry || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      throw new Error('MQTT_LEASE_CLAIM_RESPONSE_INVALID');
    }
    return { operationId, leaseToken: row.leaseToken as string };
  }

  async reportUncertain(operationId: string, leaseToken: string): Promise<void> {
    if (!validUuid(operationId) || !validUuid(leaseToken)) {
      throw new Error('MQTT_LEASE_REPORT_INPUT_INVALID');
    }
    let rows: unknown[];
    try {
      const result = await this.leaseWorker.query(
        `SELECT devices.fn_report_mqtt_pairing_uncertain(
           $1::uuid, $2::uuid, $3::text
         ) AS reported`,
        [operationId, leaseToken, UNKNOWN_RESULT_CODE],
      );
      rows = result.rows;
    } catch {
      throw new Error('MQTT_LEASE_REPORT_OUTCOME_UNKNOWN');
    }
    if (!Array.isArray(rows) || rows.length !== 1 ||
        !rows[0] || typeof rows[0] !== 'object' ||
        (rows[0] as Record<string, unknown>).reported !== true) {
      throw new Error('MQTT_LEASE_REPORT_RESPONSE_INVALID');
    }
  }
}
