import type { ShellyPairingSessionService } from './shelly-pairing-session.service';
import type { ShellyMqttAuthenticationWorker } from './shelly-mqtt-authentication.worker';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const SUPPORTED_MODEL = 'S4SW-001P16EU';

export interface ShellyMqttAuthenticationRequest {
  readonly userId: string;
  readonly homeId: string;
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly operationId: string;
}

/** HTTP authorization around the internal broker-proof worker. */
export class ShellyMqttAuthenticationAction {
  constructor(
    private readonly sessions: Pick<
      ShellyPairingSessionService,
      'assertCanManageHome' | 'get'
    >,
    private readonly worker: Pick<ShellyMqttAuthenticationWorker, 'confirm'>,
  ) {}

  async confirm(input: ShellyMqttAuthenticationRequest): Promise<
    | {
        readonly phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED';
        readonly mqttAuthenticated: true;
        readonly alreadyConfirmed?: true;
      }
    | {
        readonly phase: 'PAIRING_ALREADY_COMPLETED';
        readonly mqttAuthenticated: true;
        readonly alreadyConfirmed: true;
      }
  > {
    if (!UUID.test(input.operationId) || !UUID.test(input.sessionId) ||
        !UUID.test(input.userId) || !UUID.test(input.homeId) ||
        !TOKEN.test(input.sessionToken)) {
      throw new Error('SHELLY_MQTT_AUTH_REQUEST_INVALID');
    }

    await this.sessions.assertCanManageHome(input.userId, input.homeId);
    const session = await this.sessions.get(
      input.userId, input.homeId, input.sessionId, input.sessionToken,
    );
    if (session.sessionId !== input.sessionId || session.homeId !== input.homeId) {
      throw new Error('SHELLY_MQTT_AUTH_SESSION_NOT_ACTIVE');
    }

    // This state is persisted only by SQL029 after the broker RPC proof.
    if (session.status === 'COMPLETED') {
      return {
        phase: 'PAIRING_ALREADY_COMPLETED',
        mqttAuthenticated: true,
        alreadyConfirmed: true,
      };
    }
    if (session.status === 'CONNECTED') {
      return {
        phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED',
        mqttAuthenticated: true,
        alreadyConfirmed: true,
      };
    }
    if (!session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new Error('SHELLY_MQTT_AUTH_SESSION_NOT_ACTIVE');
    }
    if (session.status !== 'WAITING_FOR_MQTT' ||
        session.identity?.modelCode !== SUPPORTED_MODEL ||
        session.identity.generation !== 4 ||
        session.identity.verification !== 'MOBILE_REPORTED_UNVERIFIED' ||
        !session.identity.manufacturerDeviceId) {
      throw new Error('SHELLY_MQTT_AUTH_SESSION_NOT_AWAITING_DEVICE');
    }

    await this.worker.confirm(
      input.operationId,
      session.identity.manufacturerDeviceId,
    );

    // SQL029 owns CONNECTED. Re-read it after the worker transaction so an
    // uncertain SQL result never becomes a successful HTTP response.
    await this.sessions.assertCanManageHome(input.userId, input.homeId);
    const confirmed = await this.sessions.get(
      input.userId, input.homeId, input.sessionId, input.sessionToken,
    );
    if (confirmed.sessionId !== input.sessionId ||
        confirmed.homeId !== input.homeId ||
        !['CONNECTED', 'COMPLETED'].includes(confirmed.status) ||
        confirmed.identity?.manufacturerDeviceId !== session.identity.manufacturerDeviceId) {
      throw new Error('SHELLY_MQTT_AUTH_PERSISTENCE_UNCERTAIN');
    }
    if (confirmed.status === 'COMPLETED') {
      return {
        phase: 'PAIRING_ALREADY_COMPLETED',
        mqttAuthenticated: true,
        alreadyConfirmed: true,
      };
    }
    return {
      phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED',
      mqttAuthenticated: true,
    };
  }
}
