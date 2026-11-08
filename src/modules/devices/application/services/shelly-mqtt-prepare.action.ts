import type {
  ShellyMqttReservationCoordinator,
  ShellyReservationRequest,
} from './shelly-mqtt-reservation.coordinator';
import type { ShellyMqttPreparationCoordinator } from './shelly-mqtt-preparation.coordinator';

/**
 * Phase 504.10, server only. Does not enable MQTT, does not deliver the password
 * to Android and NEVER marks the device CONNECTED or COMPLETED.
 */
export class ShellyMqttPrepareAction {
  constructor(
    private readonly reservations: Pick<ShellyMqttReservationCoordinator, 'reserve'>,
    private readonly preparations: Pick<ShellyMqttPreparationCoordinator, 'prepare'>,
  ) {}

  async execute(request: ShellyReservationRequest): Promise<{
    phase: 'PREPARED_DISABLED_ONLY';
    operationId: string;
    credentialsDelivered: false;
    mqttAuthenticated: false;
  }> {
    const reservation = await this.reservations.reserve(request);
    const result = await this.preparations.prepare(reservation);
    if (result.phase !== 'PREPARED_DISABLED_ONLY' ||
        result.operationId !== reservation.operationId) {
      throw new Error('MQTT_PREPARE_RESULT_INVALID');
    }
    // Deliberately does not return username, roleName, clientId, token or secrets.
    return {
      phase: 'PREPARED_DISABLED_ONLY',
      operationId: reservation.operationId,
      credentialsDelivered: false,
      mqttAuthenticated: false,
    };
  }
}
