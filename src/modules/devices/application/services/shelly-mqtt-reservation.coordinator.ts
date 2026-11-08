import { createHash } from 'node:crypto';
import type { ShellyPairingSessionService } from './shelly-pairing-session.service';
import type { MqttRuntimeService } from '../../infrastructure/messaging/mqtt-runtime.service';
import {
  assertShellyMqttReservationScope,
  buildShellyMqttAclPlan,
  type ShellyMqttAclPlan,
} from './shelly-mqtt-acl.policy';

/**
 * Implement this port ONLY with a specialized connection/role.
 * The SQL function devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)
 * is NOT executable with the regular smarthome_app credential.
 *
 * IMPORTANT: this interface does NOT grant permission to enable the broker.
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
  /** Opaque owner token: never logged or returned. */
  readonly sessionToken: string;
}

/**
 * INTERNAL result, never a public DTO. Carries no credentials.
 * The RESERVED_ONLY value does not represent authentication or enabling.
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
 * The SQL reservation validates OWNER, session and the reported identity; the scope comes
 * derived from the backend contract. Does not call Mosquitto, create devices or
 * return passwords.
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

    // Only sends sessionId and the scope DERIVED from the authorized session.
    // Never accepts a manufacturerId, ACL or scope supplied through HTTP.
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

    // The privileged function locks/validates its SQL row. In addition,
    // the OWNER+token authorization is repeated, since access can change
    // between two connections or two different transactions.
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
    // SQL 022 generates the three names from id_mqtt_identity.
    // That correspondence is checked without granting broker access.
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
