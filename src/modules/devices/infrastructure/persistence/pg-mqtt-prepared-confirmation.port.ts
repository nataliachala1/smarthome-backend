/**
 * Puerto EXCLUSIVO para confirmar la migracion 027.
 * IMPORTANTE: el cliente debe autenticarse con una cuenta propia cuyo unico
 * privilegio de escritura sea EXECUTE sobre fn_confirm_mqtt_pairing_prepared.
 * NO reutilizar DATABASE_URL, Prisma ni MqttReserverPgGateway.
 * Este adaptador NO constituye evidencia del broker: el orquestador debe
 * invocarlo solamente DESPUES de verifyPreparedDisabled().
 */
export interface MqttPreparedConfirmationQueryClient {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface ConfirmMqttPreparedInput {
  readonly operationId: string;
  readonly leaseToken: string;
  readonly identityId: string;
  readonly username: string;
  readonly clientId: string;
  readonly roleName: string;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class PgMqttPreparedConfirmationPort {
  constructor(private readonly confirmer: MqttPreparedConfirmationQueryClient) {}

  async confirm(input: ConfirmMqttPreparedInput): Promise<void> {
    if (!UUID_V4.test(input.operationId) ||
        !UUID_V4.test(input.leaseToken) ||
        !UUID_V4.test(input.identityId)) {
      throw new Error('MQTT_PREPARED_CONFIRM_INPUT_INVALID');
    }
    const suffix = input.identityId.replace(/-/g, '');
    if (input.username !== `shd_${suffix}` ||
        input.clientId !== `shd-${suffix}` ||
        input.roleName !== `role_shd_${suffix}`) {
      throw new Error('MQTT_PREPARED_CONFIRM_BINDING_INVALID');
    }

    let rows: unknown[];
    try {
      const result = await this.confirmer.query(
        `SELECT devices.fn_confirm_mqtt_pairing_prepared(
           $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
         ) AS confirmed`,
        [input.operationId, input.leaseToken, input.identityId,
          input.username, input.clientId, input.roleName],
      );
      rows = result.rows;
    } catch {
      // Un timeout DESPUES de ejecutar SQL deja un resultado incierto.
      // No devolver un falso negativo que permita reintentos inseguros.
      throw new Error('MQTT_PREPARED_CONFIRM_OUTCOME_UNKNOWN');
    }
    if (!Array.isArray(rows) || rows.length !== 1 ||
        !rows[0] || typeof rows[0] !== 'object' ||
        (rows[0] as Record<string, unknown>).confirmed !== true) {
      throw new Error('MQTT_PREPARED_CONFIRM_RESPONSE_INVALID');
    }
  }
}
