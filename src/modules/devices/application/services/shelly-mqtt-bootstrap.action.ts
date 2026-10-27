import { createDecipheriv, createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext, rootCertificates } from 'node:tls';
import { SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL } from '../../../../config/mqtt-config';
import type { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import type { MqttRuntimeService } from '../../infrastructure/messaging/mqtt-runtime.service';
import {
  assertShellyMqttReservationScope,
  buildShellyMqttAclPlan,
} from './shelly-mqtt-acl.policy';
import type { ShellyPairingSessionService } from './shelly-pairing-session.service';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Must match CreateShellyPairingSessionDto; SQL receives only this token's SHA-256.
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const NAME = /^[A-Za-z0-9_-]{1,128}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const MAX_CA_BYTES = 16_384;
const MAX_DELIVERY_TTL_MS = 120_000;

export interface MqttAuthorizedBootstrapEnvelope {
  operationId: string;
  identityId: string;
  manufacturerDeviceId: string;
  username: string;
  clientId: string;
  topicScope: string;
  formatVersion: number;
  keyId: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
  expiresAt: Date | string;
}

export interface MqttAuthorizedBootstrapPort {
  load(
    operationId: string,
    actorId: string,
    tokenHash: string,
  ): Promise<MqttAuthorizedBootstrapEnvelope>;
}

export type ShellyMqttBootstrapProfile = 'local-dev' | 'vps-dev-tls';

export interface ShellyMqttBootstrapSettings {
  readonly profile: ShellyMqttBootstrapProfile;
  readonly localCaFile?: string;
  readonly publicBrokerUrl?: string;
  readonly publicCaFile?: string;
  readonly adminCaFile?: string;
}

export interface ShellyBootstrapRequest {
  readonly userId: string;
  readonly homeId: string;
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly operationId: string;
  /** Used only by the isolated local laboratory profile. */
  readonly labTrustConfirmed?: boolean;
}

type AuthorizedSession = Awaited<ReturnType<ShellyPairingSessionService['get']>>;

export interface DeviceBrokerConfiguration {
  readonly hostname: string;
  readonly port: number;
  readonly caPem: string;
}

function expiryMillis(value: Date | string | null | undefined): number {
  const millis = value instanceof Date
    ? value.getTime()
    : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(millis) ? millis : NaN;
}

function isActiveSession(session: AuthorizedSession, input: ShellyBootstrapRequest): boolean {
  return session.sessionId === input.sessionId &&
    session.homeId === input.homeId &&
    ['DEVICE_IDENTIFIED', 'WAITING_FOR_MQTT'].includes(session.status) &&
    expiryMillis(session.expiresAt) > Date.now() &&
    session.identity?.modelCode === 'S4SW-001P16EU' &&
    session.identity.generation === 4 &&
    session.identity.verification === 'MOBILE_REPORTED_UNVERIFIED' &&
    typeof session.identity.manufacturerDeviceId === 'string';
}

function readCaPem(file: string, requirePublicTrustRoot: boolean): string {
  try {
    const caPem = readFileSync(file, 'utf8');
    const certificates = caPem.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    );
    if (!certificates || certificates.length !== 1 ||
        Buffer.byteLength(caPem, 'utf8') > MAX_CA_BYTES ||
        caPem.replace(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
          '',
        ).trim()) {
      throw new Error();
    }

    const certificate = new X509Certificate(certificates[0]);
    if (!certificate.ca) throw new Error();
    createSecureContext({ ca: Buffer.from(caPem, 'utf8'), minVersion: 'TLSv1.2' });

    if (requirePublicTrustRoot) {
      const publicRootFingerprints = new Set(
        rootCertificates.map((pem) => new X509Certificate(pem).fingerprint256),
      );
      if (!publicRootFingerprints.has(certificate.fingerprint256)) {
        throw new Error();
      }
    }
    return caPem;
  } catch {
    throw new Error('MQTT_BOOTSTRAP_CA_INVALID');
  }
}

export class ShellyMqttBootstrapAction {
  private readonly aesKey: Buffer;

  constructor(
    private readonly sessions: Pick<
      ShellyPairingSessionService,
      'get' | 'assertCanManageHome'
    >,
    private readonly secrets: MqttAuthorizedBootstrapPort,
    private readonly runtime: Pick<MqttRuntimeService, 'config' | 'topics'>,
    private readonly broker: Pick<
      MqttDeviceIdentityProvider,
      'verifyPreparedDisabled'
    >,
    aesKeyB64: string,
    private readonly keyId: string,
    private readonly settings: ShellyMqttBootstrapSettings,
  ) {
    if (!SECRET.test(aesKeyB64) || keyId !== 'dev-mqtt-aes-v1') {
      throw new Error('MQTT_BOOTSTRAP_KEY_NOT_READY');
    }
    const decoded = Buffer.from(aesKeyB64, 'base64url');
    if (decoded.length !== 32 || decoded.toString('base64url') !== aesKeyB64) {
      decoded.fill(0);
      throw new Error('MQTT_BOOTSTRAP_KEY_NOT_READY');
    }
    this.aesKey = decoded;
  }

  async authorize(input: ShellyBootstrapRequest) {
    this.assertProfile(input);
    if (!UUID_V4.test(input.userId) || !UUID_V4.test(input.homeId) ||
        !UUID_V4.test(input.sessionId) || !UUID_V4.test(input.operationId) ||
        !TOKEN.test(input.sessionToken)) {
      throw new Error('MQTT_BOOTSTRAP_REQUEST_INVALID');
    }

    // Endpoint y CA del Shelly se validan separados de la conexión privada
    // del backend, antes de consumir una lectura autorizada SQL031.
    const deviceBroker = this.deviceBrokerConfiguration();

    await this.sessions.assertCanManageHome(input.userId, input.homeId);
    const before = await this.sessions.get(
      input.userId, input.homeId, input.sessionId, input.sessionToken,
    );
    if (!isActiveSession(before, input)) {
      throw new Error('MQTT_BOOTSTRAP_SESSION_NOT_AUTHORIZED');
    }

    const tokenHash = createHash('sha256')
      .update(input.sessionToken, 'utf8')
      .digest('hex');
    const row = await this.secrets.load(
      input.operationId,
      input.userId,
      tokenHash,
    );

    const suffix = row.identityId?.replace(/-/g, '');
    const until = expiryMillis(row.expiresAt);
    if (row.operationId !== input.operationId ||
        !UUID_V4.test(row.identityId) ||
        row.manufacturerDeviceId !== before.identity?.manufacturerDeviceId ||
        row.username !== `shd_${suffix}` || !NAME.test(row.username) ||
        row.clientId !== `shd-${suffix}` || !NAME.test(row.clientId) ||
        row.topicScope.length < 1 || row.topicScope.length > 256 ||
        row.formatVersion !== 1 || row.keyId !== this.keyId ||
        !Number.isFinite(until) || until <= Date.now()) {
      throw new Error('MQTT_BOOTSTRAP_BINDING_INVALID');
    }

    const plan = buildShellyMqttAclPlan(
      this.runtime.topics,
      row.manufacturerDeviceId,
      this.runtime.config.switchId,
    );
    assertShellyMqttReservationScope(
      plan,
      row.manufacturerDeviceId,
      row.topicScope,
    );

    // SQL031 confirma PREPARED_DISABLED y limita las entregas. Mosquitto se
    // consulta además para comprobar identidad, ACL y deshabilitado actuales.
    await this.broker.verifyPreparedDisabled({
      username: row.username,
      clientId: row.clientId,
      roleName: `role_shd_${suffix}`,
      topicScope: plan.topicScope,
      acls: plan.acls,
    });

    await this.sessions.assertCanManageHome(input.userId, input.homeId);
    const after = await this.sessions.get(
      input.userId, input.homeId, input.sessionId, input.sessionToken,
    );
    if (!isActiveSession(after, input) ||
        after.identity?.manufacturerDeviceId !== row.manufacturerDeviceId ||
        expiryMillis(after.expiresAt) < until || until <= Date.now()) {
      throw new Error('MQTT_BOOTSTRAP_SESSION_CHANGED');
    }

    const nonce = this.decodeEnvelopeField(row.nonce, 12);
    const ciphertext = this.decodeEnvelopeField(row.ciphertext, 43);
    const tag = this.decodeEnvelopeField(row.authTag, 16);
    let password: string;
    try {
      const decryptor = createDecipheriv('aes-256-gcm', this.aesKey, nonce);
      decryptor.setAAD(Buffer.from(
        `smarthome:mqtt:preparation-password:v1:${this.keyId}:${row.operationId}`,
        'utf8',
      ));
      decryptor.setAuthTag(tag);
      password = Buffer.concat([
        decryptor.update(ciphertext),
        decryptor.final(),
      ]).toString('utf8');
      if (!SECRET.test(password) ||
          password === this.runtime.config.username ||
          password === this.runtime.config.password) {
        throw new Error();
      }
    } catch {
      throw new Error('MQTT_BOOTSTRAP_DECRYPT_FAILED');
    }

    return {
      phase: 'PROVISIONING_AUTHORIZED' as const,
      mqttAuthenticated: false as const,
      manufacturerDeviceId: row.manufacturerDeviceId,
      expiresAt: new Date(Math.min(until, Date.now() + MAX_DELIVERY_TTL_MS)).toISOString(),
      broker: deviceBroker,
      identity: {
        username: row.username,
        password,
        clientId: row.clientId,
        topicPrefix: row.topicScope,
      },
    };
  }

  private assertProfile(input: ShellyBootstrapRequest): void {
    if (this.settings.profile === 'local-dev') {
      if (process.env.NODE_ENV !== 'development' ||
          process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP !== 'true' ||
          input.labTrustConfirmed !== true) {
        throw new Error('MQTT_BOOTSTRAP_TRUST_REQUIRED');
      }
      return;
    }

    if (process.env.NODE_ENV !== 'production' ||
        process.env.APP_ENV !== 'development' ||
        process.env.SHELLY_MQTT_DEV_DI_ENABLED !== 'true' ||
        process.env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED !== 'true' ||
        process.env.SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED !== 'true' ||
        process.env.SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED !== 'true' ||
        process.env.MQTT_ENABLED !== 'true') {
      throw new Error('MQTT_BOOTSTRAP_VPS_PROFILE_NOT_ALLOWED');
    }
  }

  private deviceBrokerConfiguration(): DeviceBrokerConfiguration {
    if (this.settings.profile === 'local-dev') {
      const config = this.runtime.config;
      if (!config.brokerUrl || !config.tls || !config.caFile) {
        throw new Error('MQTT_BOOTSTRAP_MQTTS_REQUIRED');
      }
      let url: URL;
      try {
        url = new URL(config.brokerUrl);
      } catch {
        throw new Error('MQTT_BOOTSTRAP_BROKER_CONFIG_INVALID');
      }
      if (url.protocol !== 'mqtts:' || !url.hostname ||
          config.caFile !== this.settings.localCaFile) {
        throw new Error('MQTT_BOOTSTRAP_BROKER_CONFIG_INVALID');
      }
      return {
        hostname: url.hostname,
        port: Number(url.port || 8883),
        caPem: readCaPem(config.caFile, false),
      };
    }

    if (this.settings.publicBrokerUrl !==
          SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL ||
        !this.settings.publicCaFile ||
        this.settings.publicCaFile === this.runtime.config.caFile ||
        this.settings.publicCaFile === this.settings.adminCaFile) {
      throw new Error('MQTT_BOOTSTRAP_PUBLIC_BROKER_NOT_ALLOWED');
    }

    let url: URL;
    try {
      url = new URL(this.settings.publicBrokerUrl);
    } catch {
      throw new Error('MQTT_BOOTSTRAP_PUBLIC_BROKER_NOT_ALLOWED');
    }
    if (url.protocol !== 'mqtts:' ||
        url.hostname !== 'mqtt-dev.179-236-82-122.sslip.io' ||
        url.port !== '443' || url.username || url.password ||
        (url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
      throw new Error('MQTT_BOOTSTRAP_PUBLIC_BROKER_NOT_ALLOWED');
    }

    return {
      hostname: url.hostname,
      port: Number(url.port),
      // Solo se devuelve una CA raiz publica incluida en el trust store de Node.
      caPem: readCaPem(this.settings.publicCaFile, true),
    };
  }

  private decodeEnvelopeField(value: string, bytes: number): Buffer {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('MQTT_BOOTSTRAP_ENVELOPE_INVALID');
    }
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length !== bytes || decoded.toString('base64url') !== value) {
      throw new Error('MQTT_BOOTSTRAP_ENVELOPE_INVALID');
    }
    return decoded;
  }
}
