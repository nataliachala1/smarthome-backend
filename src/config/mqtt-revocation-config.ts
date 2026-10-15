export const MQTT_REVOCATION_SETTINGS = [
  'NODE_ENV',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'DATABASE_URL',
  'DATABASE_IOT_URL',
  'MQTT_REVOCATION_ENABLED',
  'MQTT_IDENTITY_PROVIDER',
  'DATABASE_MQTT_REVOKE_URL',
  'DATABASE_MQTT_REVOKE_TLS',
  'DATABASE_MQTT_REVOKE_CA_FILE',
  'MQTT_ADMIN_USERNAME',
  'MQTT_ADMIN_PASSWORD',
  'MQTT_ADMIN_CLIENT_ID',
  'MQTT_USERNAME',
  'MQTT_CLIENT_ID',
  'MQTT_STATUS_CLIENT_ID',
  'MQTT_BROKER_URL',
  'MQTT_REVOCATION_POLL_MS',
] as const;

export type MqttRevocationConfiguration =
  | { enabled: false }
  | {
      enabled: true;
      database: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
      };
      databaseTls: boolean;
      databaseCaFile?: string;
      adminUsername: string;
      adminPassword: string;
      adminClientId: string;
      pollMs: number;
    };

export function parseMqttRevocationConfig(
  env: Record<string, unknown>,
): MqttRevocationConfiguration {
  function read(key: string): string | undefined {
    const value = env[key];
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`MQTT_REVOCATION_CONFIG_INVALID:${key}`);
    return value;
  }
  function required(key: string): string {
    const value = read(key);
    if (!value) throw new Error(`MQTT_REVOCATION_CONFIG_REQUIRED:${key}`);
    return value;
  }
  const enabled = read('MQTT_REVOCATION_ENABLED') ?? 'false';
  if (!['true', 'false'].includes(enabled))
    throw new Error('MQTT_REVOCATION_CONFIG_INVALID:MQTT_REVOCATION_ENABLED');
  if (enabled === 'false') return { enabled: false };
  // MQTT connectivity does not imply support for Mosquitto Dynamic Security.
  // Require an explicit administrative provider before any SQL or broker I/O.
  const provider = required('MQTT_IDENTITY_PROVIDER');
  if (provider === 'emqx-serverless')
    throw new Error('MQTT_REVOCATION_PROVIDER_UNSUPPORTED');
  if (provider !== 'mosquitto-dynamic-security')
    throw new Error('MQTT_REVOCATION_CONFIG_INVALID:MQTT_IDENTITY_PROVIDER');
  const production = read('NODE_ENV') === 'production';
  const tls =
    read('DATABASE_MQTT_REVOKE_TLS') ?? (production ? 'true' : 'false');
  if (
    !['true', 'false'].includes(tls) ||
    (production && tls !== 'true') ||
    read('NODE_TLS_REJECT_UNAUTHORIZED') === '0'
  )
    throw new Error('MQTT_REVOCATION_TLS_REQUIRED');
  const databaseCaFile = read('DATABASE_MQTT_REVOKE_CA_FILE');
  if (databaseCaFile && tls !== 'true')
    throw new Error('MQTT_REVOCATION_DATABASE_CA_REQUIRES_TLS');
  function databaseUrl(key: string): URL {
    try {
      const raw = required(key);
      const url = new URL(raw);
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        !url.hostname ||
        !url.username ||
        !url.pathname.slice(1) ||
        raw.trim() !== raw
      )
        throw new Error();
      // Verify percent-encoding without including any input in errors.
      decodeURIComponent(url.username);
      decodeURIComponent(url.password);
      decodeURIComponent(url.pathname);
      return url;
    } catch {
      throw new Error(`MQTT_REVOCATION_DATABASE_URL_INVALID:${key}`);
    }
  }
  const database = databaseUrl('DATABASE_MQTT_REVOKE_URL');
  if (
    !database.password ||
    database.search ||
    database.hash ||
    database.port === '0'
  )
    throw new Error(
      'MQTT_REVOCATION_DATABASE_URL_INVALID:DATABASE_MQTT_REVOKE_URL',
    );
  for (const key of ['DATABASE_URL', 'DATABASE_IOT_URL']) {
    const other = databaseUrl(key);
    if (
      other.hostname !== database.hostname ||
      (other.port || '5432') !== (database.port || '5432') ||
      decodeURIComponent(other.pathname) !==
        decodeURIComponent(database.pathname)
    )
      throw new Error('MQTT_REVOCATION_DATABASE_TARGET_MISMATCH');
    if (
      decodeURIComponent(other.username) ===
      decodeURIComponent(database.username)
    )
      throw new Error('MQTT_REVOCATION_DATABASE_LOGIN_MUST_BE_SEPARATE');
  }
  const adminUsername = required('MQTT_ADMIN_USERNAME');
  const adminPassword = required('MQTT_ADMIN_PASSWORD');
  const adminClientId = required('MQTT_ADMIN_CLIENT_ID');
  if (!/^[A-Za-z0-9_-]{1,128}(?![\s\S])/.test(adminClientId))
    throw new Error('MQTT_REVOCATION_ADMIN_CLIENT_ID_INVALID');
  if (
    adminUsername === read('MQTT_USERNAME') ||
    [read('MQTT_CLIENT_ID'), read('MQTT_STATUS_CLIENT_ID')].includes(
      adminClientId,
    )
  )
    throw new Error('MQTT_REVOCATION_ADMIN_IDENTITY_MUST_BE_SEPARATE');
  if (!required('MQTT_BROKER_URL').startsWith('mqtts://'))
    throw new Error('MQTT_REVOCATION_BROKER_TLS_REQUIRED');
  const poll = read('MQTT_REVOCATION_POLL_MS') ?? '1000';
  if (!/^[0-9]+(?![\s\S])/.test(poll) || +poll < 250 || +poll > 60000)
    throw new Error('MQTT_REVOCATION_POLL_INVALID');
  return {
    enabled: true,
    database: {
      host: database.hostname.replace(/^\[|\]$/g, ''),
      port: +(database.port || '5432'),
      database: decodeURIComponent(database.pathname.slice(1)),
      user: decodeURIComponent(database.username),
      password: decodeURIComponent(database.password),
    },
    databaseTls: tls === 'true',
    databaseCaFile,
    adminUsername,
    adminPassword,
    adminClientId,
    pollMs: +poll,
  };
}
