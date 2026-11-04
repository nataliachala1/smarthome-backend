import {
  createShellyRpcChallenge,
  matchesBrokerIdentityConnection,
  matchesShellyRpcChallenge,
  type ShellyRpcChallenge,
  type ShellyRpcMessage,
  type ReservedBrokerBinding,
} from './shelly-mqtt-rpc-challenge.policy';
import type { ShellyMqttAclPlan } from './shelly-mqtt-acl.policy';
import type { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';

export interface MqttRpcChallengeTransport {
  /** Se suscribe a la respuesta ANTES de publicar la peticion. No hace reintentos. */
  exchange(challenge: ShellyRpcChallenge): Promise<ShellyRpcMessage>;
}

/**
 * Prueba de observacion; NO autoriza HTTP, no cambia SQL ni sesiones.
 * El worker llamador debe verificar la reserva, el lease vigente y que las
 * ACL exclusivas del equipo impiden publicaciones de otros principals MQTT.
 * Para el estado CONNECTED se requiere una transicion SQL nueva, cercada
 * por un token, ligada a la identidad y a la sesion autorizada.
 */
export class ShellyMqttBrokerProofCoordinator {
  constructor(
    private readonly identities: Pick<MqttDeviceIdentityProvider, 'inspectIdentity'>,
    private readonly transport: MqttRpcChallengeTransport,
  ) {}

  async observe(input: {
    readonly plan: ShellyMqttAclPlan;
    readonly binding: ReservedBrokerBinding;
  }): Promise<{ readonly phase: 'MQTT_CHALLENGE_MATCHED_UNPERSISTED'; readonly mqttObserved: true }> {
    const { plan, binding } = input;
    if (!plan || !binding || !/^[A-Za-z0-9_-]{1,128}$/.test(binding.username) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(binding.clientId) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(binding.roleName)) {
      throw new Error('SHELLY_MQTT_PROOF_BINDING_INVALID');
    }
    // getClient() debe confirmar cliente habilitado Y conectado. No basta
    // con la existencia de una identidad preparada/deshabilitada.
    const before = await this.identities.inspectIdentity(binding.username);
    if (!matchesBrokerIdentityConnection(before, binding)) {
      throw new Error('SHELLY_MQTT_PROOF_BROKER_NOT_AUTHENTICATED');
    }
    const challenge = createShellyRpcChallenge(plan);
    const message = await this.transport.exchange(challenge);
    if (!matchesShellyRpcChallenge(challenge, message) || Date.now() > challenge.expiresAtMs) {
      throw new Error('SHELLY_MQTT_PROOF_RPC_UNVERIFIED');
    }
    // Observacion fresca DESPUES de la respuesta; tiempo y correlacion
    // se verifican de nuevo, sin suponer autor MQTT por la sola respuesta.
    const after = await this.identities.inspectIdentity(binding.username);
    if (!matchesBrokerIdentityConnection(after, binding) || Date.now() > challenge.expiresAtMs) {
      throw new Error('SHELLY_MQTT_PROOF_BROKER_UNCERTAIN');
    }
    // Nunca retornar password, broker admin, el nonce/RPC ID o credenciales.
    return { phase: 'MQTT_CHALLENGE_MATCHED_UNPERSISTED', mqttObserved: true };
  }
}
