import { createCipheriv, randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import type { VerifyPreparedMqttIdentityInput } from '../../domain/services/mqtt-device-identity-provider';
import { ShellyMqttBootstrapAction } from './shelly-mqtt-bootstrap.action';

const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOME = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const IDENTITY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DEVICE_ID = 'shelly1pmg4-abcdef123456';
const TOKEN = 'a'.repeat(43);
const KEY_ID = 'dev-mqtt-aes-v1';
const KEY = randomBytes(32);
const DEVICE_PASSWORD = randomBytes(32).toString('base64url');
const SUFFIX = IDENTITY.replace(/-/g, '');
const TOPIC_SCOPE = `smarthome/dev/v1/devices/${DEVICE_ID}`;
const BROKER_URL = 'mqtts://mqtt-dev.179-236-82-122.sslip.io:443';
const PUBLIC_CA = rootCertificates[0];
const SECRET_URL = 'smarthome:mqtt:preparation-password:v1';

function encryptedEnvelope(overrides: Record<string, unknown> = {}) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, nonce);
  cipher.setAAD(Buffer.from(`${SECRET_URL}:${KEY_ID}:${OP}`, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(DEVICE_PASSWORD, 'utf8'),
    cipher.final(),
  ]);
  return {
    operationId: OP,
    identityId: IDENTITY,
    manufacturerDeviceId: DEVICE_ID,
    username: `shd_${SUFFIX}`,
    clientId: `shd-${SUFFIX}`,
    topicScope: TOPIC_SCOPE,
    formatVersion: 1,
    keyId: KEY_ID,
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    ...overrides,
  };
}

const session = {
  sessionId: SESSION,
  homeId: HOME,
  status: 'DEVICE_IDENTIFIED',
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  identity: {
    modelCode: 'S4SW-001P16EU',
    generation: 4,
    verification: 'MOBILE_REPORTED_UNVERIFIED',
    manufacturerDeviceId: DEVICE_ID,
  },
};

describe('Bootstrap MQTT VPS DEV - authorization, TLS y secreto individual', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shelly-mqtt-bootstrap-'));
  const publicCaFile = join(directory, 'public-root-ca.pem');
  const adminCaFile = join(directory, 'admin-ca.pem');
  const previousEnv = new Map<string, string | undefined>();
  const env = {
    NODE_ENV: 'production',
    APP_ENV: 'development',
    SHELLY_MQTT_DEV_DI_ENABLED: 'true',
    SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'true',
    SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'true',
    SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED: 'true',
    MQTT_ENABLED: 'true',
  };

  beforeAll(() => {
    for (const key of [
      ...Object.keys(env),
      'SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP',
    ]) previousEnv.set(key, process.env[key]);
    writeFileSync(publicCaFile, PUBLIC_CA, 'utf8');
    writeFileSync(adminCaFile, 'PRIVATE_ADMIN_CA_MUST_NOT_BE_RETURNED', 'utf8');
  });

  beforeEach(() => {
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    delete process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP;
  });

  afterAll(() => {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  function fixture(options: {
    readonly settings?: Record<string, unknown>;
    readonly sessionBefore?: Record<string, unknown>;
    readonly sessionAfter?: Record<string, unknown>;
    readonly envelope?: Record<string, unknown>;
    readonly profile?: 'local-dev' | 'vps-dev-tls';
  } = {}) {
    const sessions = {
      assertCanManageHome: jest.fn().mockResolvedValue(undefined),
      get: jest.fn()
        .mockResolvedValueOnce(options.sessionBefore ?? session)
        .mockResolvedValueOnce(options.sessionAfter ?? session),
    };
    const secrets = {
      load: jest.fn().mockResolvedValue(options.envelope ?? encryptedEnvelope({
        expiresAt: session.expiresAt,
      })),
    };
    const broker = {
      verifyPreparedDisabled: jest.fn(
        (input: VerifyPreparedMqttIdentityInput): Promise<void> => {
          void input;
          return Promise.resolve();
        },
      ),
    };
    const runtime = {
      config: {
        brokerUrl: 'mqtts://mosquitto-dev:8883',
        caFile: '/run/secrets/mosquitto-dev-ca.pem',
        tls: true,
        username: 'backend-service',
        password: 'backend-service-password',
        switchId: 0,
      },
      topics: {
        shellyPrefix: (deviceId: string) => `smarthome/dev/v1/devices/${deviceId}`,
        control: (deviceId: string) =>
          `smarthome/dev/v1/devices/${deviceId}/rpc`,
      },
    };
    const settings = {
      profile: options.profile ?? 'vps-dev-tls',
      publicBrokerUrl: BROKER_URL,
      publicCaFile,
      adminCaFile,
      ...options.settings,
    } as {
      profile: 'local-dev' | 'vps-dev-tls';
      publicBrokerUrl?: string;
      publicCaFile?: string;
      adminCaFile?: string;
    };
    const action = new ShellyMqttBootstrapAction(
      sessions,
      secrets,
      runtime as never,
      broker,
      KEY.toString('base64url'),
      KEY_ID,
      settings,
    );
    const input = {
      userId: USER,
      homeId: HOME,
      sessionId: SESSION,
      sessionToken: TOKEN,
      operationId: OP,
      labTrustConfirmed: false,
    };
    return { action, sessions, secrets, broker, runtime, settings, input };
  }

  it('entrega una identidad individual al OWNER sin depender de la aprobacion del laboratorio', async () => {
    const f = fixture();
    const result = await f.action.authorize(f.input);

    expect(result.phase).toBe('PROVISIONING_AUTHORIZED');
    expect(result.mqttAuthenticated).toBe(false);
    expect(result.manufacturerDeviceId).toBe(DEVICE_ID);
    expect(result.broker).toEqual({
      hostname: 'mqtt-dev.179-236-82-122.sslip.io',
      port: 443,
      caPem: PUBLIC_CA,
    });
    expect(result.identity).toEqual({
      username: `shd_${SUFFIX}`,
      password: DEVICE_PASSWORD,
      clientId: `shd-${SUFFIX}`,
      topicPrefix: TOPIC_SCOPE,
    });
    expect(result.identity.password).not.toBe(f.runtime.config.password);
    expect(JSON.stringify(result)).not.toContain('mosquitto-dev');
    expect(JSON.stringify(result)).not.toContain(adminCaFile);
    expect(Date.parse(result.expiresAt)).toBeLessThanOrEqual(Date.now() + 120_000);
    expect(f.sessions.assertCanManageHome).toHaveBeenCalledTimes(2);
    expect(f.secrets.load).toHaveBeenCalledWith(
      OP,
      USER,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(f.broker.verifyPreparedDisabled).toHaveBeenCalledTimes(1);
    const [verification] = f.broker.verifyPreparedDisabled.mock.calls[0];
    expect(verification).toMatchObject({
      username: `shd_${SUFFIX}`,
      clientId: `shd-${SUFFIX}`,
      roleName: `role_shd_${SUFFIX}`,
      topicScope: TOPIC_SCOPE,
    });
    expect(verification.acls.some((acl) =>
      acl.topic === `${TOPIC_SCOPE}/events/rpc`,
    )).toBe(true);
  });

  it('requiere OWNER antes de leer el sobre SQL', async () => {
    const f = fixture();
    f.sessions.assertCanManageHome.mockRejectedValue(new Error('OWNER_REQUIRED'));
    await expect(f.action.authorize(f.input)).rejects.toThrow('OWNER_REQUIRED');
    expect(f.sessions.get).not.toHaveBeenCalled();
    expect(f.secrets.load).not.toHaveBeenCalled();
  });

  it('rechaza sesiones expiradas antes de cargar secretos', async () => {
    const f = fixture({
      sessionBefore: {
        ...session,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    await expect(f.action.authorize(f.input))
      .rejects.toThrow('MQTT_BOOTSTRAP_SESSION_NOT_AUTHORIZED');
    expect(f.secrets.load).not.toHaveBeenCalled();
  });

  it('no admite respuesta del sobre expirada ni para otra operacion', async () => {
    const expired = fixture({
      envelope: encryptedEnvelope({
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    });
    await expect(expired.action.authorize(expired.input))
      .rejects.toThrow('MQTT_BOOTSTRAP_BINDING_INVALID');
    expect(expired.broker.verifyPreparedDisabled).not.toHaveBeenCalled();

    const wrongOperation = fixture({
      envelope: encryptedEnvelope({
        operationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    });
    await expect(wrongOperation.action.authorize(wrongOperation.input))
      .rejects.toThrow('MQTT_BOOTSTRAP_BINDING_INVALID');
  });

  it('aisla el endpoint publico de la CA interna y de la CA administrativa', async () => {
    for (const settings of [
      { publicBrokerUrl: 'mqtts://mosquitto-dev:8883' },
      { publicCaFile: '/run/secrets/mosquitto-dev-ca.pem' },
      { publicCaFile: adminCaFile },
    ]) {
      const f = fixture({ settings });
      await expect(f.action.authorize(f.input)).rejects.toThrow();
      expect(f.secrets.load).not.toHaveBeenCalled();
    }
  });

  it('acepta solo una CA raiz incluida en el trust store publico de Node', async () => {
    const f = fixture();
    writeFileSync(publicCaFile, 'NOT_A_CERTIFICATE', 'utf8');
    await expect(f.action.authorize(f.input))
      .rejects.toThrow('MQTT_BOOTSTRAP_CA_INVALID');
    expect(f.secrets.load).not.toHaveBeenCalled();
    writeFileSync(publicCaFile, PUBLIC_CA, 'utf8');
  });

  it('no lee secretos en Production funcional ni con pairing desactivado', async () => {
    const f = fixture();
    process.env.APP_ENV = 'production';
    await expect(f.action.authorize(f.input))
      .rejects.toThrow('MQTT_BOOTSTRAP_VPS_PROFILE_NOT_ALLOWED');
    expect(f.secrets.load).not.toHaveBeenCalled();

    process.env.APP_ENV = 'development';
    process.env.SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED = 'false';
    await expect(f.action.authorize(f.input))
      .rejects.toThrow('MQTT_BOOTSTRAP_VPS_PROFILE_NOT_ALLOWED');
    expect(f.secrets.load).not.toHaveBeenCalled();
  });

  it('requiere la aprobacion de laboratorio solo en local-dev', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP = 'true';
    const f = fixture({
      profile: 'local-dev',
      settings: {
        localCaFile: '/run/secrets/mosquitto-dev-ca.pem',
      },
    });
    await expect(f.action.authorize(f.input))
      .rejects.toThrow('MQTT_BOOTSTRAP_TRUST_REQUIRED');
    expect(f.secrets.load).not.toHaveBeenCalled();
    delete process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP;
  });

  it('no entrega credenciales si Mosquitto no confirma identidad deshabilitada', async () => {
    const f = fixture();
    f.broker.verifyPreparedDisabled.mockRejectedValue(
      new Error('MQTT_DYNSEC_PREPARE_NOT_CONFIRMED'),
    );
    await expect(f.action.authorize(f.input))
      .rejects.toThrow('MQTT_DYNSEC_PREPARE_NOT_CONFIRMED');
    expect(f.sessions.get).toHaveBeenCalledTimes(1);
  });

  it('vuelve a autorizar hogar y sesion antes de descifrar y entregar', async () => {
    const f = fixture({
      sessionAfter: { ...session, status: 'CANCELLED' },
    });
    await expect(f.action.authorize(f.input))
      .rejects.toThrow('MQTT_BOOTSTRAP_SESSION_CHANGED');
    expect(f.sessions.assertCanManageHome).toHaveBeenCalledTimes(2);
    expect(f.broker.verifyPreparedDisabled).toHaveBeenCalledTimes(1);
  });
});
