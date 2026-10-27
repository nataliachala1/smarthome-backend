import { createHash } from 'node:crypto';
import type { ShellyPairingSessionService } from './shelly-pairing-session.service';
import type { MqttRuntimeService } from '../../infrastructure/messaging/mqtt-runtime.service';
import {
  assertShellyMqttReservationScope,
  buildShellyMqttAclPlan,
  type ShellyMqttAclPlan,
} from './shelly-mqtt-acl.policy';

/**
 * Implementar este puerto SOLO con una conexion/rol especializado.
 * La funcion SQL devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)
 * NO es ejecutable con la credencial normal smarthome_app.
 *
 * IMPORTANTE: esta interfaz NO concede permiso para habilitar el broker.
 */
export interface MqttPrivilegedReservationPort {
  reserve(
    sessionId: string,
    derivedTopicScope: string,
    actorId: string,
    tokenProofHash: string,
  ): Promise<{
    operationId: string;
    identityId: string;
    username: string;
    clientId: string;
    roleName: string;
    reservedTopicScope: string;
  }>;
}

type AuthorizedSession = Awaited<ReturnType<ShellyPairingSessionService['get']>>;

export interface ShellyReservationRequest {
  readonly userId: string;
  readonly homeId: string;
  readonly sessionId: string;
  /** Token opaco del propietario: nunca se registra ni se devuelve. */
  readonly sessionToken: string;
}

/**
 * Resultado INTERNO, nunca DTO publico. No transporta credenciales.
 * El valor RESERVED_ONLY no representa autenticacion ni habilitacion.
 */
export interface ShellyInternalReservation {
  readonly phase: 'RESERVED_ONLY';
  readonly operationId: string;
  readonly identityId: string;
  readonly username: string;
  readonly clientId: string;
  readonly roleName: string;
  readonly plan: ShellyMqttAclPlan;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUPPORTED_MODEL = 'S4SW-001P16EU';

/**
 * Una coordinacion conservadora SOLO de reserva. NO llama Mosquitto, NO
 * crea dispositivos, NO modifica estados HU16 y NO entrega passwords.
 *
 * Se deja SIN REGISTRAR en DevicesModule hasta implementar un gateway
 * PostgreSQL separado, las transiciones durables y recuperacion de fallos.
 */
export class ShellyMqttReservationCoordinator {
  constructor(
    private readonly sessions: Pick<ShellyPairingSessionService, 'get'>,
    private readonly registrar: MqttPrivilegedReservationPort,
    private readonly runtime: Pick<MqttRuntimeService, 'topics' | 'config'>,
  ) {}

  async reserve(input: ShellyReservationRequest): Promise<ShellyInternalReservation> {
    const before = await this.sessions.get(
      input.userId, input.homeId, input.sessionId, input.sessionToken,
    );
    const physicalId = this.assertReservable(before, input);
    const plan = buildShellyMqttAclPlan(
      this.runtime.topics, physicalId, this.runtime.config.switchId,
    );

    // Solo envía sessionId y scope DERIVADO de la sesion autorizada.
    // Nunca acepta manufacturerId, ACL o scope introducidos por HTTP.
    // Never pass the raw pairing token to the privileged database role.
    // The digest is an authentication proof and must not be logged.
    const tokenProofHash = createHash('sha256')
      .update(input.sessionToken, 'utf8').digest('hex');
    const reserved = await this.registrar.reserve(
      input.sessionId, plan.topicScope, input.userId, tokenProofHash,
    );
    assertShellyMqttReservationScope(
      plan, physicalId, reserved.reservedTopicScope,
    );
    this.assertBrokerBinding(reserved);

    // La funcion privilegiada bloquea/valida su fila SQL. Adicionalmente
    // repetimos la autorizacion OWNER+token, ya que el acceso puede cambiar
    // entre dos conexiones o dos transacciones diferentes.
    const after = await this.sessions.get(
      input.userId, input.homeId, input.sessionId, input.sessionToken,
    );
    const currentPhysicalId = this.assertReservable(after, input);
    if (currentPhysicalId !== physicalId) {
      throw new Error('SHELLY_MQTT_SESSION_CHANGED');
    }

    return {
      phase: 'RESERVED_ONLY',
      operationId: reserved.operationId,
      identityId: reserved.identityId,
      username: reserved.username,
      clientId: reserved.clientId,
      roleName: reserved.roleName,
      plan,
    };
  }

  private assertReservable(
    session: AuthorizedSession,
    request: ShellyReservationRequest,
  ): string {
    if (
      session.sessionId !== request.sessionId ||
      session.homeId !== request.homeId ||
      (session.status !== 'DEVICE_IDENTIFIED' &&
        session.status !== 'WAITING_FOR_MQTT') ||
      !session.expiresAt ||
      new Date(session.expiresAt).getTime() <= Date.now() ||
      session.identity?.modelCode !== SUPPORTED_MODEL ||
      session.identity?.generation !== 4 ||
      session.identity?.verification !== 'MOBILE_REPORTED_UNVERIFIED' ||
      !session.identity.manufacturerDeviceId
    ) {
      throw new Error('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
    }
    return session.identity.manufacturerDeviceId;
  }

  private assertBrokerBinding(reservation: Awaited<ReturnType<MqttPrivilegedReservationPort['reserve']>>): void {
    // La SQL 022 genera los tres nombres a partir de id_mqtt_identity.
    // Comprobamos esa correspondencia sin conceder acceso al broker.
    if (!UUID_V4.test(reservation.operationId) || !UUID_V4.test(reservation.identityId)) {
      throw new Error('SHELLY_MQTT_RESERVATION_BINDING_INVALID');
    }
    const suffix = reservation.identityId.replace(/-/g, '');
    if (
      reservation.username !== `shd_${suffix}` ||
      reservation.clientId !== `shd-${suffix}` ||
      reservation.roleName !== `role_shd_${suffix}`
    ) {
      throw new Error('SHELLY_MQTT_RESERVATION_BINDING_INVALID');
    }
  }
}
