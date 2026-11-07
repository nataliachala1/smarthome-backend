import {
  parseMqttConfig,
  SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL,
} from '../../../../config/mqtt-config';
import { isIP } from 'node:net';

/** Selection of test MQTT connections. Never decides the target from HTTP. */
export type ShellyMqttDeploymentMode =
  | 'off'
  | 'local-dev'
  | 'vps-dev-tls'
  | 'production-mosquitto';

type Environment = Record<string, string | undefined>;

const VPS_DEV_DATABASE_HOST = 'smart-home-smarthomepostgresdev-vrmtpz';
const VPS_DEV_BROKER_HOST = 'mosquitto-dev';
const VPS_DEV_BROKER_PORT = '8883';

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDevDatabaseUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return ['postgres:', 'postgresql:'].includes(url.protocol) &&
      Boolean(url.hostname) && Boolean(url.username) &&
      url.pathname === '/smarthome_dev';
  } catch {
    return false;
  }
}

function isVpsDevDatabaseUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname === VPS_DEV_DATABASE_HOST && url.port === '5432' &&
      url.pathname === '/smarthome_dev' && Boolean(url.username) &&
      Boolean(url.password) &&
      (url.search === '' || url.search === '?sslmode=require') && !url.hash;
  } catch {
    return false;
  }
}

function isDedicatedVpsMqttDatabaseUrl(
  raw: string | undefined,
  username: string,
): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'postgresql:' &&
      url.hostname === VPS_DEV_DATABASE_HOST && url.port === '5432' &&
      url.pathname === '/smarthome_dev' && url.username === username &&
      /^[A-Za-z0-9_-]{43}$/.test(url.password) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isAuthorizedVpsBrokerUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'mqtts:' &&
      url.hostname === VPS_DEV_BROKER_HOST &&
      url.port === VPS_DEV_BROKER_PORT &&
      !url.username && !url.password &&
      (url.pathname === '' || url.pathname === '/') &&
      !url.search && !url.hash;
  } catch {
    return false;
  }
}

function hasPreparedVpsPairingConfiguration(env: Environment): boolean {
  if (
    env.SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED !== 'true' ||
    env.NODE_ENV !== 'production' || env.APP_ENV !== 'development' ||
    env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED !== 'true' ||
    env.SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED !== 'true' ||
    env.MQTT_ENABLED !== 'true' ||
    env.SHELLY_MQTT_VPS_DEV_BROKER_HOST !== VPS_DEV_BROKER_HOST ||
    (env.MQTT_TLS_REJECT_UNAUTHORIZED !== undefined &&
      env.MQTT_TLS_REJECT_UNAUTHORIZED !== 'true') ||
    (env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined &&
      env.NODE_TLS_REJECT_UNAUTHORIZED !== '1') ||
    !isVpsDevDatabaseUrl(env.DATABASE_URL) ||
    !isVpsDevDatabaseUrl(env.DATABASE_IOT_URL) ||
    !isAuthorizedVpsBrokerUrl(env.MQTT_BROKER_URL) ||
    !hasText(env.MQTT_USERNAME) || !hasText(env.MQTT_PASSWORD) ||
    !hasText(env.MQTT_TLS_CA_FILE) ||
    !isAuthorizedVpsBrokerUrl(env.MQTT_DYNSEC_ADMIN_URL) ||
    !hasText(env.MQTT_DYNSEC_ADMIN_USERNAME) ||
    !hasText(env.MQTT_DYNSEC_ADMIN_PASSWORD) ||
    env.MQTT_DYNSEC_ADMIN_USERNAME === env.MQTT_USERNAME ||
    env.MQTT_DYNSEC_ADMIN_PASSWORD === env.MQTT_PASSWORD ||
    !hasText(env.MQTT_DYNSEC_ADMIN_CA_FILE) ||
    env.SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL !==
      SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL ||
    !hasText(env.SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE) ||
    env.SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE === env.MQTT_TLS_CA_FILE ||
    env.SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE === env.MQTT_DYNSEC_ADMIN_CA_FILE ||
    !isDedicatedVpsMqttDatabaseUrl(
      env.MQTT_RESERVER_DATABASE_URL,
      'smarthome_mqtt_reserver_dev_login',
    ) ||
    !isDedicatedVpsMqttDatabaseUrl(
      env.MQTT_LEASE_DATABASE_URL,
      'smarthome_mqtt_lease_dev_login',
    ) ||
    !isDedicatedVpsMqttDatabaseUrl(
      env.MQTT_CONFIRMER_DATABASE_URL,
      'smarthome_mqtt_confirmer_dev_login',
    ) ||
    !isDedicatedVpsMqttDatabaseUrl(
      env.MQTT_SECRET_DATABASE_URL,
      'smarthome_mqtt_secret_dev_login',
    ) ||
    !isDedicatedVpsMqttDatabaseUrl(
      env.MQTT_REVOCATION_DATABASE_URL,
      'smarthome_mqtt_revoke_dev_login',
    )
  ) {
    return false;
  }

  const encodedKey = env.MQTT_PREPARATION_AES_KEY_B64URL;
  const keyId = env.MQTT_PREPARATION_AES_KEY_ID;
  if (!encodedKey || !/^[A-Za-z0-9_-]{43}$/.test(encodedKey) ||
      keyId !== 'dev-mqtt-aes-v1') return false;

  const key = Buffer.from(encodedKey, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== encodedKey) return false;

  try {
    const mqtt = parseMqttConfig(env);
    return mqtt.tls && mqtt.brokerUrl === env.MQTT_BROKER_URL &&
      mqtt.namespace?.startsWith('smarthome/dev/') === true;
  } catch {
    return false;
  }
}

const PRODUCTION_MQTT_DATABASE_LOGINS = {
  MQTT_RESERVER_DATABASE_URL: 'smarthome_mqtt_reserver_prod_login',
  MQTT_LEASE_DATABASE_URL: 'smarthome_mqtt_lease_prod_login',
  MQTT_CONFIRMER_DATABASE_URL: 'smarthome_mqtt_confirmer_prod_login',
  MQTT_SECRET_DATABASE_URL: 'smarthome_mqtt_secret_prod_login',
  MQTT_REVOCATION_DATABASE_URL: 'smarthome_mqtt_revoke_prod_login',
  MQTT_RPC_DATABASE_URL: 'smarthome_mqtt_rpc_prod_login',
  MQTT_AUTH_DATABASE_URL: 'smarthome_mqtt_auth_prod_login',
} as const;

interface DatabaseTarget {
  readonly hostname: string;
  readonly port: string;
  readonly database: string;
  readonly username: string;
}

function isProductionHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = normalized === '::1' || normalized === '::' ||
    normalized.startsWith('127.') || normalized === '0.0.0.0' ||
    normalized.startsWith('::ffff:127.');
  return !loopback &&
    !['localhost', VPS_DEV_DATABASE_HOST].includes(normalized) &&
    !/(?:^|[-.])(dev|development|test|testing|staging|stage)(?:[-.]|$)/i.test(normalized);
}

function productionDatabaseTarget(
  raw: string | undefined,
  expectedUsername?: string,
): DatabaseTarget | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const username = decodeURIComponent(url.username);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (url.protocol !== 'postgresql:' || !isProductionHostname(url.hostname) ||
        url.port !== '5432' || !username || !url.password ||
        !/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(database) ||
        /(?:^|_)(dev|development|test|testing|staging|stage)(?:_|$)/i.test(database) ||
        url.search || url.hash ||
        (expectedUsername !== undefined && username !== expectedUsername)) {
      return null;
    }
    if (expectedUsername !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(url.password)) {
      return null;
    }
    return { hostname: url.hostname, port: url.port, database, username };
  } catch {
    return null;
  }
}

function productionMqttDatabaseSetReady(env: Environment): boolean {
  const appDb = productionDatabaseTarget(env.DATABASE_URL);
  const iotDb = productionDatabaseTarget(env.DATABASE_IOT_URL);
  if (!appDb || !iotDb || appDb.hostname !== iotDb.hostname ||
      appDb.port !== iotDb.port || appDb.database !== iotDb.database) return false;

  for (const [key, role] of Object.entries(PRODUCTION_MQTT_DATABASE_LOGINS)) {
    const target = productionDatabaseTarget(env[key], role);
    if (!target || target.hostname !== appDb.hostname || target.port !== appDb.port ||
        target.database !== appDb.database) return false;
  }
  return true;
}

function safeProductionBrokerUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'mqtts:' || !isProductionHostname(url.hostname) ||
        url.username || url.password || (url.pathname !== '' && url.pathname !== '/') ||
        url.search || url.hash || (url.port !== '' &&
          (!/^\d+$/.test(url.port) || +url.port < 1 || +url.port > 65535))) return null;
    return url;
  } catch {
    return null;
  }
}

function hasPreparedProductionPairingConfiguration(env: Environment): boolean {
  if (
    env.SHELLY_MQTT_PRODUCTION_PAIRING_ENABLED !== 'true' ||
    env.SHELLY_MQTT_PRODUCTION_REVOCATION_WORKER_ENABLED !== 'true' ||
    env.SHELLY_MQTT_PRODUCTION_AUTH_WORKER_ENABLED !== 'true' ||
    env.NODE_ENV !== 'production' || env.APP_ENV !== 'production' ||
    env.SHELLY_MQTT_DEV_DI_ENABLED === 'true' ||
    env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED === 'true' ||
    env.SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED === 'true' ||
    env.SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED === 'true' ||
    env.SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED === 'true' ||
    env.SHELLY_MQTT_VPS_DEV_REVOCATION_WORKER_ENABLED === 'true' ||
    env.MQTT_ENABLED !== 'true' || env.MQTT_BROKER_PROVIDER !== 'mosquitto' ||
    env.MQTT_TOPIC_NAMESPACE !== 'smarthome/prod/v1' ||
    !hasText(env.MQTT_USERNAME) || !hasText(env.MQTT_PASSWORD) ||
    !hasText(env.MQTT_DYNSEC_ADMIN_USERNAME) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(env.MQTT_DYNSEC_ADMIN_USERNAME) ||
    !hasText(env.MQTT_DYNSEC_ADMIN_PASSWORD) ||
    env.MQTT_DYNSEC_ADMIN_USERNAME === env.MQTT_USERNAME ||
    env.MQTT_DYNSEC_ADMIN_PASSWORD === env.MQTT_PASSWORD ||
    !productionMqttDatabaseSetReady(env)
  ) return false;

  const backendBroker = safeProductionBrokerUrl(env.MQTT_BROKER_URL);
  const adminBroker = safeProductionBrokerUrl(env.MQTT_DYNSEC_ADMIN_URL);
  const deviceBroker = safeProductionBrokerUrl(
    env.SHELLY_MQTT_PRODUCTION_DEVICE_BROKER_URL,
  );
  const developmentCa = env.SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE;
  const productionCaFiles = [
    env.SHELLY_MQTT_PRODUCTION_DEVICE_CA_FILE,
    env.MQTT_TLS_CA_FILE,
    env.MQTT_DYNSEC_ADMIN_CA_FILE,
  ].filter(hasText);
  if (!backendBroker || !adminBroker || !deviceBroker ||
      backendBroker.hostname !== adminBroker.hostname ||
      backendBroker.port !== adminBroker.port ||
      backendBroker.hostname === deviceBroker.hostname ||
      !deviceBroker.hostname.includes('.') || isIP(deviceBroker.hostname) !== 0 ||
      /\.(?:local|localhost|internal|lan|test)$/i.test(deviceBroker.hostname) ||
      env.SHELLY_MQTT_PRODUCTION_DEVICE_BROKER_URL ===
        SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL ||
      !hasText(env.SHELLY_MQTT_PRODUCTION_DEVICE_CA_FILE) ||
      (hasText(developmentCa) && productionCaFiles.includes(developmentCa)) ||
      !isProductionHostname(deviceBroker.hostname)) return false;

  const key = env.MQTT_PREPARATION_AES_KEY_B64URL;
  if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key) ||
      env.MQTT_PREPARATION_AES_KEY_ID !== 'prod-mqtt-aes-v1') return false;
  const material = Buffer.from(key, 'base64url');
  if (material.length !== 32 || material.toString('base64url') !== key) {
    material.fill(0);
    return false;
  }
  material.fill(0);

  try {
    const mqtt = parseMqttConfig(env);
    return mqtt.tls && mqtt.brokerUrl === env.MQTT_BROKER_URL &&
      mqtt.namespace === 'smarthome/prod/v1' && !mqtt.flespiDeviceId;
  } catch {
    return false;
  }
}

/**
 * VPS DEV runs optimized Node (NODE_ENV=production), but it is NOT the
 * functional production environment and cannot access the smarthome DB.
 * VPS mode is required through deployment opt-ins and general DEV DBs.
 */
export function selectShellyMqttDeploymentMode(
  env: Environment = process.env,
): ShellyMqttDeploymentMode {
  if (env.SHELLY_MQTT_PRODUCTION_PAIRING_ENABLED === 'true') {
    if (!hasPreparedProductionPairingConfiguration(env)) {
      throw new Error('MQTT_PRODUCTION_PAIRING_NOT_ALLOWED');
    }
    return 'production-mosquitto';
  }
  if (env.SHELLY_MQTT_DEV_DI_ENABLED !== 'true') return 'off';

  if (env.NODE_ENV === 'development' &&
      env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED !== 'true') {
    return 'local-dev';
  }

  if (env.NODE_ENV === 'production' &&
      env.APP_ENV === 'development' &&
      env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED === 'true' &&
      // PostgreSQL DI stays separate: the opt-in transport does NOT register
      // controllers, coordinators or workers in the VPS DEV profile.
      (env.MQTT_ENABLED === 'false' ||
        (env.MQTT_ENABLED === 'true' &&
         env.SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED === 'true')) &&
      isDevDatabaseUrl(env.DATABASE_URL) &&
      isDevDatabaseUrl(env.DATABASE_IOT_URL)) {
    return 'vps-dev-tls';
  }
  throw new Error('MQTT_DEV_DI_MODE_NOT_ALLOWED');
}

/** Defense in depth: the gateway validates role, host, DB and TLS again. */
export function requireShellyMqttDeploymentMode(
  env: Environment = process.env,
): Exclude<ShellyMqttDeploymentMode, 'off'> {
  const mode = selectShellyMqttDeploymentMode(env);
  if (mode === 'off') throw new Error('MQTT_DEV_DI_DISABLED');
  return mode;
}

/**
 * Decides provider groups in a single place; it does NOT enable MQTT by itself.
 */
export interface ShellyMqttProviderPlan {
  readonly mode: ShellyMqttDeploymentMode;
  readonly localWorkflow: boolean;
  readonly vpsPgOnly: boolean;
  readonly vpsPairing: boolean;
  readonly localAuthWorker: boolean;
  readonly vpsAuthPgOnly: boolean;
  readonly vpsAuthWorker: boolean;
  readonly vpsRevocationWorker: boolean;
  readonly productionPairing: boolean;
  readonly productionAuthWorker: boolean;
  readonly productionRevocationWorker: boolean;
}

export function selectShellyMqttProviderPlan(
  env: Environment = process.env,
): ShellyMqttProviderPlan {
  const mode = selectShellyMqttDeploymentMode(env);
  const authRequested = env.SHELLY_MQTT_AUTH_DEV_DI_ENABLED === 'true';
  const vpsPairingConfigured = mode === 'vps-dev-tls' &&
    hasPreparedVpsPairingConfiguration(env);
  const vpsRevocationWorker = vpsPairingConfigured &&
    env.SHELLY_MQTT_VPS_DEV_REVOCATION_WORKER_ENABLED === 'true';
  // Never expose prepare/bootstrap unless durable cleanup is registered too.
  const vpsPairing = vpsRevocationWorker;
  const vpsAuthWorker = vpsPairing && authRequested &&
    env.SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED === 'true';
  return {
    mode,
    localWorkflow: mode === 'local-dev',
    vpsPgOnly: mode === 'vps-dev-tls',
    vpsPairing,
    localAuthWorker: mode === 'local-dev' && authRequested,
    vpsAuthPgOnly: mode === 'vps-dev-tls' && authRequested && !vpsAuthWorker,
    vpsAuthWorker,
    vpsRevocationWorker,
    productionPairing: mode === 'production-mosquitto',
    productionAuthWorker: mode === 'production-mosquitto',
    productionRevocationWorker: mode === 'production-mosquitto',
  };
}
