import {
  parseMqttConfig,
  SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL,
} from '../../../../config/mqtt-config';

/** Seleccion de conexiones MQTT de pruebas. Nunca determina el destino desde HTTP. */
export type ShellyMqttDeploymentMode = 'off' | 'local-dev' | 'vps-dev-tls';

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

/**
 * VPS DEV ejecuta Node optimizado (NODE_ENV=production), pero NO es el
 * entorno funcional de produccion ni puede acceder a la BD smarthome.
 * El modo VPS se exige por opt-ins de despliegue y DBs generales DEV.
 */
export function selectShellyMqttDeploymentMode(
  env: Environment = process.env,
): ShellyMqttDeploymentMode {
  if (env.SHELLY_MQTT_DEV_DI_ENABLED !== 'true') return 'off';

  if (env.NODE_ENV === 'development' &&
      env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED !== 'true') {
    return 'local-dev';
  }

  if (env.NODE_ENV === 'production' &&
      env.APP_ENV === 'development' &&
      env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED === 'true' &&
      // La DI PostgreSQL continua separada: transporte opt-in NO registra
      // controladores, coordinadores ni workers en el perfil VPS DEV.
      (env.MQTT_ENABLED === 'false' ||
        (env.MQTT_ENABLED === 'true' &&
         env.SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED === 'true')) &&
      isDevDatabaseUrl(env.DATABASE_URL) &&
      isDevDatabaseUrl(env.DATABASE_IOT_URL)) {
    return 'vps-dev-tls';
  }
  throw new Error('MQTT_DEV_DI_MODE_NOT_ALLOWED');
}

/** Defensa por duplicado: el gateway vuelve a validar rol, host, BD y TLS. */
export function requireShellyMqttDeploymentMode(
  env: Environment = process.env,
): Exclude<ShellyMqttDeploymentMode, 'off'> {
  const mode = selectShellyMqttDeploymentMode(env);
  if (mode === 'off') throw new Error('MQTT_DEV_DI_DISABLED');
  return mode;
}

/**
 * Decide grupos de providers en un solo punto; NO habilita MQTT por sí mismo.
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
  };
}
