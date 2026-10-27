/** Seleccion de conexiones MQTT de pruebas. Nunca determina el destino desde HTTP. */
export type ShellyMqttDeploymentMode = 'off' | 'local-dev' | 'vps-dev-tls';

type Environment = Record<string, string | undefined>;

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
 * Decide grupos de providers en un solo punto; NO habilita conexiones MQTT.
 * Para VPS DEV se permiten exclusivamente las factories SQL.
 */
export interface ShellyMqttProviderPlan {
  readonly mode: ShellyMqttDeploymentMode;
  readonly localWorkflow: boolean;
  readonly vpsPgOnly: boolean;
  readonly localAuthWorker: boolean;
  readonly vpsAuthPgOnly: boolean;
}

export function selectShellyMqttProviderPlan(
  env: Environment = process.env,
): ShellyMqttProviderPlan {
  const mode = selectShellyMqttDeploymentMode(env);
  const authRequested = env.SHELLY_MQTT_AUTH_DEV_DI_ENABLED === 'true';
  return {
    mode,
    localWorkflow: mode === 'local-dev',
    vpsPgOnly: mode === 'vps-dev-tls',
    localAuthWorker: mode === 'local-dev' && authRequested,
    vpsAuthPgOnly: mode === 'vps-dev-tls' && authRequested,
  };
}
