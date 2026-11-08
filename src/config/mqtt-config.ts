export const MQTT_SETTINGS = [
  'NODE_ENV',
  'APP_ENV',
  'DATABASE_URL',
  'DATABASE_IOT_URL',
  'SHELLY_MQTT_VPS_DEV_TLS_ENABLED',
  'SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED',
  'SHELLY_MQTT_VPS_DEV_BROKER_HOST',
  'SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL',
  'SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE',
  'SHELLY_MQTT_PRODUCTION_PAIRING_ENABLED',
  'SHELLY_MQTT_PRODUCTION_REVOCATION_WORKER_ENABLED',
  'SHELLY_MQTT_PRODUCTION_AUTH_WORKER_ENABLED',
  'SHELLY_MQTT_PRODUCTION_DEVICE_BROKER_URL',
  'SHELLY_MQTT_PRODUCTION_DEVICE_CA_FILE',
  'MQTT_DYNSEC_ADMIN_URL',
  'MQTT_DYNSEC_ADMIN_USERNAME',
  'MQTT_DYNSEC_ADMIN_PASSWORD',
  'MQTT_DYNSEC_ADMIN_CA_FILE',
  'MQTT_RESERVER_DATABASE_URL',
  'MQTT_LEASE_DATABASE_URL',
  'MQTT_CONFIRMER_DATABASE_URL',
  'MQTT_SECRET_DATABASE_URL',
  'MQTT_REVOCATION_DATABASE_URL',
  'MQTT_RPC_DATABASE_URL',
  'MQTT_AUTH_DATABASE_URL',
  'MQTT_PREPARATION_AES_KEY_B64URL',
  'MQTT_PREPARATION_AES_KEY_ID',
  'MQTT_ENABLED',
  'MQTT_BROKER_PROVIDER',
  'MQTT_FLESPI_DEVICE_ID',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'MQTT_BROKER_URL',
  'MQTT_USERNAME',
  'MQTT_PASSWORD',
  'MQTT_CLIENT_ID',
  'MQTT_STATUS_CLIENT_ID',
  'MQTT_TLS_CA_FILE',
  'MQTT_TLS_REJECT_UNAUTHORIZED',
  'MQTT_TOPIC_NAMESPACE',
  'MQTT_CONTROL_TOPIC_PREFIX',
  'MQTT_STATUS_TOPIC_FILTER',
  'MQTT_SHELLY_SWITCH_TOPIC_FILTER',
  'MQTT_SHELLY_RPC_EVENTS_TOPIC_FILTER',
  'MQTT_SHELLY_RPC_SOURCE',
  'MQTT_SHELLY_SWITCH_ID',
] as const;

/** Public TLS endpoint used by the Shelly; backend transport remains private. */
export const SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL =
  'mqtts://mqtt-dev.179-236-82-122.sslip.io:443';

export interface MqttConfiguration {
  brokerUrl?: string;
  tls: boolean;
  username?: string;
  password?: string;
  controlClientId?: string;
  statusClientId?: string;
  caFile?: string;
  namespace?: string;
  /** Scope explicitly authorized by the single-device flespi MQTT ACL token. */
  flespiDeviceId?: string;
  devicePrefix: string;
  rpcSource: string;
  switchId: number;
}

// Absolute end-of-input: unlike $, this also rejects a final newline.
const topicPath = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?![\s\S])/;
export const mqttDeviceId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}(?![\s\S])/;

/** VPS DEV uses a dedicated PostgreSQL host, never the Production smarthome DB. */
function isVpsDevDatabaseUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname === 'smart-home-smarthomepostgresdev-vrmtpz' &&
      url.port === '5432' && url.pathname === '/smarthome_dev' &&
      Boolean(url.username) && Boolean(url.password);
  } catch {
    return false;
  }
}

export function parseMqttConfig(
  environment: Record<string, unknown>,
): MqttConfiguration {
  const read = (name: string): string | undefined => {
    const value = environment[name];
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${name} must be a non-empty string.`);
    }
    return value;
  };
  const production = read('NODE_ENV') === 'production';
  const vpsDev = production && read('APP_ENV') === 'development';
  const enabledSetting = read('MQTT_ENABLED');
  if (enabledSetting !== undefined && !['true', 'false'].includes(enabledSetting)) {
    throw new Error('MQTT_ENABLED must be true or false.');
  }
  // Opt-in: outside VPS DEV the historical behavior is kept.
  const brokerProvider = read('MQTT_BROKER_PROVIDER') ?? 'mosquitto';
  if (!['mosquitto', 'flespi'].includes(brokerProvider)) {
    throw new Error('MQTT_BROKER_PROVIDER_INVALID');
  }
  const flespi = brokerProvider === 'flespi';
  if (flespi && (!vpsDev || enabledSetting !== 'true')) {
    throw new Error('MQTT_FLESPI_DEV_MODE_NOT_ALLOWED');
  }
  // Fail closed: the ACL grants only exact topics for this single Shelly.
  const flespiDeviceId = read('MQTT_FLESPI_DEVICE_ID');
  if (flespi) {
    if (!flespiDeviceId || !mqttDeviceId.test(flespiDeviceId) ||
        !/^shelly[a-z0-9-]+$/.test(flespiDeviceId)) {
      throw new Error('MQTT_FLESPI_DEVICE_ID_INVALID');
    }
  } else if (flespiDeviceId) {
    throw new Error('MQTT_FLESPI_DEVICE_ID_UNEXPECTED');
  }
  const transportOptIn = read('SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED') === 'true';
  if (vpsDev && enabledSetting !== 'false' && enabledSetting !== 'true') {
    throw new Error('MQTT_VPS_DEV_EXPLICIT_FLAG_REQUIRED');
  }
  if (transportOptIn && (!vpsDev || enabledSetting !== 'true')) {
    throw new Error('MQTT_VPS_DEV_TRANSPORT_NOT_ALLOWED');
  }
  if (vpsDev && enabledSetting === 'true' && (
    !transportOptIn ||
    read('SHELLY_MQTT_VPS_DEV_TLS_ENABLED') !== 'true' ||
    !isVpsDevDatabaseUrl(read('DATABASE_URL')) ||
    !isVpsDevDatabaseUrl(read('DATABASE_IOT_URL'))
  )) {
    throw new Error('MQTT_VPS_DEV_TRANSPORT_NOT_ALLOWED');
  }
  if (production && enabledSetting === 'false') {
    return {
      brokerUrl: undefined,
      tls: false,
      username: undefined,
      password: undefined,
      controlClientId: undefined,
      statusClientId: undefined,
      caFile: undefined,
      namespace: undefined,
      devicePrefix: 'smarthome/devices',
      rpcSource: 'smarthome-backend',
      switchId: 0,
    };
  }
  const brokerUrl = read('MQTT_BROKER_URL');
  if (flespi && brokerUrl !== 'mqtts://mqtt.flespi.io:8883') {
    throw new Error('MQTT_FLESPI_BROKER_NOT_ALLOWED');
  }
  let tls = false;
  if (brokerUrl) {
    let url: URL;
    try {
      url = new URL(brokerUrl);
    } catch {
      throw new Error('MQTT_BROKER_URL must be a valid MQTT URL.');
    }
    if (
      !['mqtt:', 'mqtts:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search ||
      url.hash ||
      !/^mqtts?:\/\/(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d+)?\/?(?![\s\S])/.test(
        brokerUrl,
      ) ||
      (url.port !== '' &&
        (!/^\d+$/.test(url.port) || +url.port < 1 || +url.port > 65535))
    ) {
      throw new Error(
        'MQTT_BROKER_URL only accepts mqtt:// or mqtts:// with a host and port, without credentials, paths or parameters.',
      );
    }
    tls = url.protocol === 'mqtts:';
    if (vpsDev && enabledSetting === 'true') {
      // The authorized host is set in the DEV deployment, not from HTTP.
      // It will be inspected as an independent DEV resource before the rollout.
      const expectedHost = read('SHELLY_MQTT_VPS_DEV_BROKER_HOST');
      if (!expectedHost || !/^[a-z0-9][a-z0-9.-]{1,249}$/.test(expectedHost) ||
          url.hostname !== expectedHost || !tls) {
        throw new Error('MQTT_VPS_DEV_BROKER_NOT_ALLOWED');
      }
    }
  }
  if (production && (!brokerUrl || !tls)) {
    throw new Error('MQTT_BROKER_URL requires mqtts:// in production.');
  }
  const username = read('MQTT_USERNAME');
  const password = read('MQTT_PASSWORD');
  if (flespi) {
    // In flespi the MQTT ACL token is the username and there is no password.
    if (!username || password) {
      throw new Error('MQTT_FLESPI_TOKEN_AUTH_REQUIRED');
    }
  } else if (Boolean(username) !== Boolean(password) || (production && !username)) {
    throw new Error(
      'MQTT_USERNAME and MQTT_PASSWORD must be configured together; they are mandatory in production.',
    );
  }
  const caFile = read('MQTT_TLS_CA_FILE');
  if (flespi && caFile) {
    // Do not mix the private CA of the DEV Mosquitto with the public roots.
    throw new Error('MQTT_FLESPI_SYSTEM_TRUST_REQUIRED');
  }
  if (vpsDev && enabledSetting === 'true' && !caFile && !flespi) {
    throw new Error('MQTT_VPS_DEV_TLS_CA_REQUIRED');
  }
  if (caFile && !tls) {
    throw new Error('MQTT_TLS_CA_FILE requires mqtts://.');
  }
  const verifyTls = read('MQTT_TLS_REJECT_UNAUTHORIZED');
  if (
    (verifyTls !== undefined && verifyTls !== 'true') ||
    (tls && read('NODE_TLS_REJECT_UNAUTHORIZED') === '0')
  ) {
    throw new Error('Disabling MQTT TLS verification is not allowed.');
  }
  const namespace = read('MQTT_TOPIC_NAMESPACE');
  if (namespace && (!topicPath.test(namespace) || namespace.length > 128)) {
    throw new Error(
      'MQTT_TOPIC_NAMESPACE must have up to 128 alphanumeric characters, hyphens and levels separated by /, without wildcards.',
    );
  }
  if (production && !namespace) {
    throw new Error('MQTT_TOPIC_NAMESPACE is mandatory in production.');
  }
  if (vpsDev && enabledSetting === 'true' &&
      !namespace?.startsWith('smarthome/dev/')) {
    throw new Error('MQTT_VPS_DEV_NAMESPACE_NOT_ALLOWED');
  }
  if (flespi && namespace !== 'smarthome/dev/v1') {
    throw new Error('MQTT_FLESPI_NAMESPACE_NOT_ALLOWED');
  }
  const legacyPrefix = read('MQTT_CONTROL_TOPIC_PREFIX');
  const devicePrefix = namespace
    ? `${namespace}/devices`
    : (legacyPrefix ?? 'smarthome/devices');
  if (!topicPath.test(devicePrefix) || devicePrefix.length > 136) {
    throw new Error('MQTT_CONTROL_TOPIC_PREFIX is not a valid MQTT prefix.');
  }
  const rawSwitchId = read('MQTT_SHELLY_SWITCH_ID') ?? '0';
  if (
    !/^\d+(?![\s\S])/.test(rawSwitchId) ||
    !Number.isSafeInteger(+rawSwitchId)
  ) {
    throw new Error('MQTT_SHELLY_SWITCH_ID must be a non-negative integer.');
  }
  const switchId = +rawSwitchId;
  const shellyPrefix = flespi
    ? `${devicePrefix}/${flespiDeviceId}`
    : namespace ? `${devicePrefix}/+` : '+';
  const derived: Record<string, string> = {
    MQTT_CONTROL_TOPIC_PREFIX: devicePrefix,
    MQTT_STATUS_TOPIC_FILTER: `${devicePrefix}/+/status`,
    MQTT_SHELLY_SWITCH_TOPIC_FILTER: `${shellyPrefix}/status/switch:${switchId}`,
    MQTT_SHELLY_RPC_EVENTS_TOPIC_FILTER: `${shellyPrefix}/events/rpc`,
  };
  for (const [key, expected] of Object.entries(derived)) {
    const configured = read(key);
    if (configured !== undefined && configured !== expected) {
      throw new Error(
        `${key} must match the contract derived from MQTT_TOPIC_NAMESPACE and MQTT_SHELLY_SWITCH_ID; remove the incompatible override.`,
      );
    }
  }
  const clientId = (key: string): string | undefined => {
    const id = read(key);
    if (id && !/^[A-Za-z0-9_-]{1,128}(?![\s\S])/.test(id)) {
      throw new Error(
        `${key} must be an alphanumeric MQTT identifier with hyphens, up to 128 characters.`,
      );
    }
    return id;
  };
  const controlClientId = clientId('MQTT_CLIENT_ID');
  const statusClientId = clientId('MQTT_STATUS_CLIENT_ID');
  if (controlClientId && controlClientId === statusClientId) {
    throw new Error(
      'MQTT_CLIENT_ID and MQTT_STATUS_CLIENT_ID must be different.',
    );
  }
  const rpcSource =
    read('MQTT_SHELLY_RPC_SOURCE') ??
    (flespi && namespace && flespiDeviceId
      ? `${namespace}/backend/${flespiDeviceId}`
      : namespace ? `${namespace}/backend` : 'smarthome-backend');
  if (flespi && rpcSource !== `${namespace}/backend/${flespiDeviceId}`) {
    throw new Error('MQTT_FLESPI_RPC_SOURCE_INVALID');
  }
  if (
    !topicPath.test(rpcSource) ||
    rpcSource.length > 256 ||
    (namespace &&
      rpcSource !== `${namespace}/backend` &&
      !rpcSource.startsWith(`${namespace}/backend/`))
  ) {
    throw new Error(
      'MQTT_SHELLY_RPC_SOURCE must be a valid prefix inside the configured backend namespace.',
    );
  }
  return {
    brokerUrl,
    tls,
    username,
    password,
    controlClientId,
    statusClientId,
    caFile,
    namespace,
    flespiDeviceId: flespi ? flespiDeviceId : undefined,
    devicePrefix,
    rpcSource,
    switchId,
  };
}
