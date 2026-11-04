import type {
  ShellyMqttReservationCoordinator,
  ShellyReservationRequest,
} from './shelly-mqtt-reservation.coordinator';
import type { ShellyMqttPreparationCoordinator } from './shelly-mqtt-preparation.coordinator';

/**
 * Fase 504.10, servidor solamente. No habilita MQTT, no entrega la password
 * al Android y JAMAS marca el dispositivo CONNECTED ni COMPLETED.
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
    // Deliberadamente no retorna username, roleName, clientId, token ni secretos.
    return {
      phase: 'PREPARED_DISABLED_ONLY',
      operationId: reservation.operationId,
      credentialsDelivered: false,
      mqttAuthenticated: false,
    };
  }
}
