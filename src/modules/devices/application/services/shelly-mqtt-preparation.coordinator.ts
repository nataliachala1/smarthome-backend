import type { ShellyInternalReservation } from './shelly-mqtt-reservation.coordinator';
import type { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import type { ConfirmMqttPreparedInput } from '../../infrastructure/persistence/pg-mqtt-prepared-confirmation.port';

/**
 * Specialized SQL contracts: lease_worker (SQL 025) and prepare_confirmer
 * (SQL 027). Registered only under profiles whose factory checks the target and
 * the privileges of each connection.
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
 * The individual secret is kept encrypted and durable per operationId; only
 * the authorized bootstrap endpoint briefly reveals it to the local flow.
 */
export interface MqttPreparationSecretPort {
  issueOrLoadForOperation(operationId: string, leaseToken: string): Promise<string>;
}

export interface PreparedOnlyResult {
  readonly phase: 'PREPARED_DISABLED_ONLY';
  readonly operationId: string;
}

/**
 * MQTT profile orchestrator: uses an authenticated reservation, leaves the account
 * disabled and only confirms PREPARED_DISABLED after re-reading Mosquitto.
 * Does not enable accounts or return passwords.
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

    // SQL function 025 validates the RESERVED state, owner, session,
    // device, validity and returns a token-fenced lease.
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
      // The key must come from a DURABLE and idempotent source.
      // Do not store it in logs, results or global environment variables.
      const password = await this.secrets.issueOrLoadForOperation(reservation.operationId, lease.leaseToken);
      if (typeof password !== 'string' || password.length < 32) {
        throw new Error('MQTT_PREPARATION_SECRET_UNAVAILABLE');
      }
      await this.broker.prepareDisabled({
        ...identity,
        operationId: reservation.operationId,
        password,
      });
      // NEW and independent verification right before SQL 027.
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
      // NEVER enable the identity or infer the result; there may be
      // a partial effect in Mosquitto or a SQL COMMIT without a response.
      try {
        await this.leases.reportUncertain(reservation.operationId, lease.leaseToken);
      } catch {
        // The reconciliation worker must inspect the durable state.
      }
      throw new Error('MQTT_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION');
    }
  }
}
