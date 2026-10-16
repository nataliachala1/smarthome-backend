import { parseMqttRevocationConfig } from './mqtt-revocation-config';
import { validateRuntimeConfig } from './runtime-config';

const enabled = () => ({
  NODE_ENV: 'test',
  JWT_SECRET: 'test-only',
  DATABASE_URL: 'postgresql://app:fixture@db.test:5432/smarthome',
  DATABASE_IOT_URL: 'postgresql://ingest:fixture@db.test:5432/smarthome',
  DATABASE_MQTT_REVOKE_URL:
    'postgresql://revoker:fixture@db.test:5432/smarthome',
  MQTT_REVOCATION_ENABLED: 'true',
  MQTT_IDENTITY_PROVIDER: 'mosquitto-dynamic-security',
  MQTT_BROKER_URL: 'mqtts://broker.test:8883',
  MQTT_USERNAME: 'service',
  MQTT_PASSWORD: 'fixture',
  MQTT_CLIENT_ID: 'service-control',
  MQTT_STATUS_CLIENT_ID: 'service-status',
  MQTT_ADMIN_USERNAME: 'admin',
  MQTT_ADMIN_PASSWORD: 'secret-fixture',
  MQTT_ADMIN_CLIENT_ID: 'admin-1',
});

describe('MQTT revocation runtime configuration', () => {
  it.each([undefined, ''])(
    'requires an explicit identity provider when enabled',
    (provider) => {
      expect(() =>
        parseMqttRevocationConfig({
          ...enabled(),
          MQTT_IDENTITY_PROVIDER: provider,
        }),
      ).toThrow('MQTT_REVOCATION_CONFIG_REQUIRED:MQTT_IDENTITY_PROVIDER');
    },
  );
  it('rejects EMQX Serverless before reading database or admin credentials', () => {
    expect(() =>
      parseMqttRevocationConfig({
        MQTT_REVOCATION_ENABLED: 'true',
        MQTT_IDENTITY_PROVIDER: 'emqx-serverless',
      }),
    ).toThrow(new Error('MQTT_REVOCATION_PROVIDER_UNSUPPORTED'));
  });
  it.each([
    'mosquitto',
    'emqx',
    ' mosquitto-dynamic-security',
    'private-input',
    1,
  ])('rejects an unknown provider without disclosing its value', (provider) => {
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        MQTT_IDENTITY_PROVIDER: provider,
      }),
    ).toThrow(
      new Error('MQTT_REVOCATION_CONFIG_INVALID:MQTT_IDENTITY_PROVIDER'),
    );
  });
  it('keeps ordinary MQTT startup available with the unsupported worker disabled', () => {
    const config = {
      ...enabled(),
      MQTT_REVOCATION_ENABLED: 'false',
      MQTT_IDENTITY_PROVIDER: 'emqx-serverless',
    };
    expect(validateRuntimeConfig(config)).toBe(config);
    expect(parseMqttRevocationConfig(config)).toEqual({ enabled: false });
  });
  it('enforces the provider guard during normal application validation', () => {
    expect(() =>
      validateRuntimeConfig({
        ...enabled(),
        MQTT_IDENTITY_PROVIDER: 'emqx-serverless',
      }),
    ).toThrow('MQTT_REVOCATION_PROVIDER_UNSUPPORTED');
  });
  it('is disabled by default and ignores unused credentials', () => {
    expect(
      parseMqttRevocationConfig({ DATABASE_MQTT_REVOKE_URL: 'invalid-secret' }),
    ).toEqual({ enabled: false });
    expect(
      parseMqttRevocationConfig({
        ...enabled(),
        MQTT_REVOCATION_ENABLED: 'false',
      }),
    ).toEqual({ enabled: false });
  });
  it('accepts an explicit isolated local test configuration', () => {
    expect(parseMqttRevocationConfig(enabled())).toMatchObject({
      enabled: true,
      databaseTls: false,
      pollMs: 1000,
      database: {
        host: 'db.test',
        port: 5432,
        user: 'revoker',
        database: 'smarthome',
      },
    });
  });
  it.each(['yes', 'TRUE', ' true', '1'])(
    'rejects ambiguous enabling %s',
    (flag) => {
      expect(() =>
        parseMqttRevocationConfig({ MQTT_REVOCATION_ENABLED: flag }),
      ).toThrow('MQTT_REVOCATION_CONFIG_INVALID');
    },
  );
  it.each([
    'DATABASE_MQTT_REVOKE_URL',
    'MQTT_ADMIN_USERNAME',
    'MQTT_ADMIN_PASSWORD',
    'MQTT_ADMIN_CLIENT_ID',
  ])('requires %s with no fallback to service credentials', (key) => {
    expect(() =>
      parseMqttRevocationConfig({ ...enabled(), [key]: '' }),
    ).toThrow(key);
  });
  it.each([
    'postgresql://app:fixture@db.test:5432/smarthome',
    'postgresql://ingest:fixture@db.test:5432/smarthome',
  ])('rejects reuse of an application or ingestion LOGIN', (url) => {
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        DATABASE_MQTT_REVOKE_URL: url,
      }),
    ).toThrow('LOGIN_MUST_BE_SEPARATE');
  });
  it.each([
    'postgresql://revoker:fixture@other.test/smarthome',
    'postgresql://revoker:fixture@db.test/other',
    'postgresql://revoker:fixture@db.test:5433/smarthome',
  ])('rejects another database target', (url) => {
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        DATABASE_MQTT_REVOKE_URL: url,
      }),
    ).toThrow('TARGET_MISMATCH');
  });
  it.each([
    '?sslmode=no-verify',
    '?options=-c%20role%3Dpostgres',
    '#secret',
    ' ',
  ])('rejects URL overrides/ambiguous formatting %s', (suffix) => {
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        DATABASE_MQTT_REVOKE_URL: enabled().DATABASE_MQTT_REVOKE_URL + suffix,
      }),
    ).toThrow('URL_INVALID');
  });
  it('requires TLS in production and rejects global TLS bypass', () => {
    expect(
      parseMqttRevocationConfig({ ...enabled(), NODE_ENV: 'production' }),
    ).toMatchObject({ databaseTls: true });
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        NODE_ENV: 'production',
        DATABASE_MQTT_REVOKE_TLS: 'false',
      }),
    ).toThrow('TLS_REQUIRED');
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toThrow('TLS_REQUIRED');
  });
  it('rejects a CA when database TLS is disabled', () => {
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        DATABASE_MQTT_REVOKE_CA_FILE: 'fixture.pem',
      }),
    ).toThrow('CA_REQUIRES_TLS');
  });
  it('requires a separate MQTT administrator and client ID', () => {
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        MQTT_ADMIN_USERNAME: 'service',
      }),
    ).toThrow('IDENTITY_MUST_BE_SEPARATE');
    for (const id of ['service-control', 'service-status'])
      expect(() =>
        parseMqttRevocationConfig({ ...enabled(), MQTT_ADMIN_CLIENT_ID: id }),
      ).toThrow('IDENTITY_MUST_BE_SEPARATE');
  });
  it.each(['0', '249', '60001', '1000abc', '1000\n'])(
    'bounds the polling interval %s',
    (poll) => {
      expect(() =>
        parseMqttRevocationConfig({
          ...enabled(),
          MQTT_REVOCATION_POLL_MS: poll,
        }),
      ).toThrow('POLL_INVALID');
    },
  );
  it('rejects plaintext MQTT even in development', () => {
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        MQTT_BROKER_URL: 'mqtt://broker.test',
      }),
    ).toThrow('BROKER_TLS_REQUIRED');
  });
  it('redacts malformed connection strings', () => {
    expect(() =>
      parseMqttRevocationConfig({
        ...enabled(),
        DATABASE_MQTT_REVOKE_URL: 'private-password-invalid',
      }),
    ).toThrow(
      new Error(
        'MQTT_REVOCATION_DATABASE_URL_INVALID:DATABASE_MQTT_REVOKE_URL',
      ),
    );
  });
  it('validates revocation configuration through normal application startup', () => {
    expect(() =>
      validateRuntimeConfig({ ...enabled(), MQTT_ADMIN_PASSWORD: '' }),
    ).toThrow('MQTT_ADMIN_PASSWORD');
  });
});
