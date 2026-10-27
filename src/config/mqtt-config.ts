export const MQTT_SETTINGS = [
  'NODE_ENV',
  'APP_ENV',
  'DATABASE_URL',
  'DATABASE_IOT_URL',
  'SHELLY_MQTT_VPS_DEV_TLS_ENABLED',
  'SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED',
  'SHELLY_MQTT_VPS_DEV_BROKER_HOST',
  'MQTT_ENABLED',
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

export interface MqttConfiguration {
  brokerUrl?: string;
  tls: boolean;
  username?: string;
  password?: string;
  controlClientId?: string;
  statusClientId?: string;
  caFile?: string;
  namespace?: string;
  devicePrefix: string;
  rpcSource: string;
  switchId: number;
}

// Absolute end-of-input: unlike $, this also rejects a final newline.
const topicPath = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?![\s\S])/;
export const mqttDeviceId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}(?![\s\S])/;

/** VPS DEV utiliza un host PostgreSQL dedicado, nunca smarthome de Production. */
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
      throw new Error(`${name} debe ser una cadena no vacía.`);
    }
    return value;
  };
  const production = read('NODE_ENV') === 'production';
  const vpsDev = production && read('APP_ENV') === 'development';
  const enabledSetting = read('MQTT_ENABLED');
  if (enabledSetting !== undefined && !['true', 'false'].includes(enabledSetting)) {
    throw new Error('MQTT_ENABLED debe ser true o false.');
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
  let tls = false;
  if (brokerUrl) {
    let url: URL;
    try {
      url = new URL(brokerUrl);
    } catch {
      throw new Error('MQTT_BROKER_URL debe ser una URL MQTT válida.');
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
        'MQTT_BROKER_URL solo admite mqtt:// o mqtts:// con host y puerto, sin credenciales, rutas ni parámetros.',
      );
    }
    tls = url.protocol === 'mqtts:';
    if (vpsDev && enabledSetting === 'true') {
      // El host autorizado se fija en el despliegue DEV, no desde HTTP.
      // Se inspeccionara como recurso DEV independiente antes del rollout.
      const expectedHost = read('SHELLY_MQTT_VPS_DEV_BROKER_HOST');
      if (!expectedHost || !/^[a-z0-9][a-z0-9.-]{1,249}$/.test(expectedHost) ||
          url.hostname !== expectedHost || !tls) {
        throw new Error('MQTT_VPS_DEV_BROKER_NOT_ALLOWED');
      }
    }
  }
  if (production && (!brokerUrl || !tls)) {
    throw new Error('MQTT_BROKER_URL requiere mqtts:// en producción.');
  }
  const username = read('MQTT_USERNAME');
  const password = read('MQTT_PASSWORD');
  if (Boolean(username) !== Boolean(password) || (production && !username)) {
    throw new Error(
      'MQTT_USERNAME y MQTT_PASSWORD deben configurarse juntos; son obligatorios en producción.',
    );
  }
  const caFile = read('MQTT_TLS_CA_FILE');
  if (vpsDev && enabledSetting === 'true' && !caFile) {
    throw new Error('MQTT_VPS_DEV_TLS_CA_REQUIRED');
  }
  if (caFile && !tls) {
    throw new Error('MQTT_TLS_CA_FILE requiere mqtts://.');
  }
  const verifyTls = read('MQTT_TLS_REJECT_UNAUTHORIZED');
  if (
    (verifyTls !== undefined && verifyTls !== 'true') ||
    (tls && read('NODE_TLS_REJECT_UNAUTHORIZED') === '0')
  ) {
    throw new Error('No se permite desactivar la verificación TLS de MQTT.');
  }
  const namespace = read('MQTT_TOPIC_NAMESPACE');
  if (namespace && (!topicPath.test(namespace) || namespace.length > 128)) {
    throw new Error(
      'MQTT_TOPIC_NAMESPACE debe tener hasta 128 caracteres alfanuméricos, guiones y niveles separados por /, sin comodines.',
    );
  }
  if (production && !namespace) {
    throw new Error('MQTT_TOPIC_NAMESPACE es obligatorio en producción.');
  }
  if (vpsDev && enabledSetting === 'true' &&
      !namespace?.startsWith('smarthome/dev/')) {
    throw new Error('MQTT_VPS_DEV_NAMESPACE_NOT_ALLOWED');
  }
  const legacyPrefix = read('MQTT_CONTROL_TOPIC_PREFIX');
  const devicePrefix = namespace
    ? `${namespace}/devices`
    : (legacyPrefix ?? 'smarthome/devices');
  if (!topicPath.test(devicePrefix) || devicePrefix.length > 136) {
    throw new Error('MQTT_CONTROL_TOPIC_PREFIX no es un prefijo MQTT válido.');
  }
  const rawSwitchId = read('MQTT_SHELLY_SWITCH_ID') ?? '0';
  if (
    !/^\d+(?![\s\S])/.test(rawSwitchId) ||
    !Number.isSafeInteger(+rawSwitchId)
  ) {
    throw new Error('MQTT_SHELLY_SWITCH_ID debe ser un entero no negativo.');
  }
  const switchId = +rawSwitchId;
  const shellyPrefix = namespace ? `${devicePrefix}/+` : '+';
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
        `${key} debe coincidir con el contrato derivado de MQTT_TOPIC_NAMESPACE y MQTT_SHELLY_SWITCH_ID; retire el override incompatible.`,
      );
    }
  }
  const clientId = (key: string): string | undefined => {
    const id = read(key);
    if (id && !/^[A-Za-z0-9_-]{1,128}(?![\s\S])/.test(id)) {
      throw new Error(
        `${key} debe ser un identificador MQTT alfanumérico con guiones, de hasta 128 caracteres.`,
      );
    }
    return id;
  };
  const controlClientId = clientId('MQTT_CLIENT_ID');
  const statusClientId = clientId('MQTT_STATUS_CLIENT_ID');
  if (controlClientId && controlClientId === statusClientId) {
    throw new Error(
      'MQTT_CLIENT_ID y MQTT_STATUS_CLIENT_ID deben ser distintos.',
    );
  }
  const rpcSource =
    read('MQTT_SHELLY_RPC_SOURCE') ??
    (namespace ? `${namespace}/backend` : 'smarthome-backend');
  if (
    !topicPath.test(rpcSource) ||
    rpcSource.length > 256 ||
    (namespace &&
      rpcSource !== `${namespace}/backend` &&
      !rpcSource.startsWith(`${namespace}/backend/`))
  ) {
    throw new Error(
      'MQTT_SHELLY_RPC_SOURCE debe ser un prefijo válido dentro del namespace backend configurado.',
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
    devicePrefix,
    rpcSource,
    switchId,
  };
}
