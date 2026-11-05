import type { ShellyInternalReservation } from './shelly-mqtt-reservation.coordinator';
import type { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import type { ConfirmMqttPreparedInput } from '../../infrastructure/persistence/pg-mqtt-prepared-confirmation.port';

/**
 * Contratos SQL especializados: lease_worker (SQL 025) y prepare_confirmer
 * (SQL 027). Solo se registra bajo perfiles cuya factory comprueba destino y
 * privilegios de cada conexión.
 */
export interface PreparationLeaseClaim {
  readonly operationId: string;
  readonly leaseToken: string;
}

export interface MqttPreparationLeasePort {
  claim(operationId: string, leaseSeconds: number): Promise<PreparationLeaseClaim>;
  reportUncertain(operationId: string, leaseToken: string): Promise<void>;
}

export interface MqttPreparedConfirmationPort {
  confirm(input: ConfirmMqttPreparedInput): Promise<void>;
}

/**
 * El secreto individual se conserva cifrado y durable por operationId; solo
 * el endpoint de bootstrap autorizado lo revela brevemente al flujo local.
 */
export interface MqttPreparationSecretPort {
  issueOrLoadForOperation(operationId: string, leaseToken: string): Promise<string>;
}

export interface PreparedOnlyResult {
  readonly phase: 'PREPARED_DISABLED_ONLY';
  readonly operationId: string;
}

/**
 * Orquestador del perfil MQTT: usa una reserva autenticada, deja la cuenta
 * deshabilitada y solo confirma PREPARED_DISABLED tras releer Mosquitto.
 * No habilita cuentas ni devuelve passwords.
 */
export class ShellyMqttPreparationCoordinator {
  constructor(
    private readonly leases: MqttPreparationLeasePort,
    private readonly broker: Pick<MqttDeviceIdentityProvider,
      'prepareDisabled' | 'verifyPreparedDisabled'>,
    private readonly confirmer: MqttPreparedConfirmationPort,
    private readonly secrets: MqttPreparationSecretPort,
  ) {}

  async prepare(reservation: ShellyInternalReservation): Promise<PreparedOnlyResult> {
    if (reservation.phase !== 'RESERVED_ONLY' ||
        !reservation.operationId || !reservation.identityId ||
        !reservation.plan || reservation.plan.acls.length !== 5 ||
        !reservation.plan.manufacturerDeviceId || !reservation.plan.topicScope) {
      throw new Error('MQTT_PREPARATION_RESERVATION_INVALID');
    }

    // La funcion SQL 025 valida estado RESERVED, propietario, sesion,
    // dispositivo, vigencia y entrega un lease cercado por token.
    const lease = await this.leases.claim(reservation.operationId, 60);
    if (lease.operationId !== reservation.operationId || !lease.leaseToken) {
      throw new Error('MQTT_PREPARATION_LEASE_INVALID');
    }

    const identity = {
      username: reservation.username,
      clientId: reservation.clientId,
      roleName: reservation.roleName,
      topicScope: reservation.plan.topicScope,
      acls: reservation.plan.acls,
    };

    try {
      // La clave debe proceder de una fuente DURABLE e idempotente.
      // No guardarla en logs, resultados ni variables de entorno globales.
      const password = await this.secrets.issueOrLoadForOperation(reservation.operationId, lease.leaseToken);
      if (typeof password !== 'string' || password.length < 32) {
        throw new Error('MQTT_PREPARATION_SECRET_UNAVAILABLE');
      }
      await this.broker.prepareDisabled({
        ...identity,
        operationId: reservation.operationId,
        password,
      });
      // Verificacion NUEVA e independiente justo antes de SQL 027.
      await this.broker.verifyPreparedDisabled(identity);
      await this.confirmer.confirm({
        operationId: reservation.operationId,
        leaseToken: lease.leaseToken,
        identityId: reservation.identityId,
        username: reservation.username,
        clientId: reservation.clientId,
        roleName: reservation.roleName,
      });
      return { phase: 'PREPARED_DISABLED_ONLY', operationId: reservation.operationId };
    } catch {
      // NUNCA habilitar identidad ni inferir resultado; puede existir
      // un efecto parcial en Mosquitto o un COMMIT SQL sin respuesta.
      try {
        await this.leases.reportUncertain(reservation.operationId, lease.leaseToken);
      } catch {
        // El worker de reconciliacion debe inspeccionar el estado durable.
      }
      throw new Error('MQTT_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION');
    }
  }
}
