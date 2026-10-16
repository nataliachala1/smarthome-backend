import { getTrustedProxies } from './trusted-proxies';
import { shellyLocalEnabled } from './shelly-local';

type Environment = Record<string, unknown>;

function setting(environment: Environment, name: string): string | undefined {
  const value = environment[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${name} debe ser una cadena de texto.`);
  }
  return value;
}

function secureCookie(
  environment: Environment,
  isProduction: boolean,
): boolean {
  const value = setting(environment, 'COOKIE_SECURE');
  if (value === undefined) return isProduction;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error('COOKIE_SECURE debe ser un valor booleano.');
}

export function getCorsOrigins(
  environment: Environment = process.env,
): string[] | false {
  const isProduction = setting(environment, 'NODE_ENV') === 'production';
  const rawOrigins =
    setting(environment, 'CORS_ALLOWED_ORIGINS') ??
    setting(environment, 'FRONTEND_URL');

  if (rawOrigins === undefined) {
    return isProduction ? false : ['http://localhost:5173'];
  }

  const origins = rawOrigins.split(',').map((origin) => {
    let url: URL;
    try {
      url = new URL(origin.trim());
    } catch {
      throw new Error(
        'CORS_ALLOWED_ORIGINS debe contener orígenes HTTP válidos.',
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'CORS_ALLOWED_ORIGINS solo admite orígenes, sin credenciales, rutas ni parámetros.',
      );
    }
    if (isProduction && url.protocol !== 'https:') {
      throw new Error('CORS_ALLOWED_ORIGINS requiere HTTPS en producción.');
    }
    return url.origin;
  });

  return [...new Set(origins)];
}

function databaseUrl(environment: Environment, name: string): URL {
  let url: URL;
  try {
    url = new URL(setting(environment, name)?.trim() ?? '');
  } catch {
    throw new Error(`${name} debe ser una URL PostgreSQL válida.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.pathname ||
    url.pathname === '/'
  ) {
    throw new Error(
      `${name} debe incluir protocolo, usuario, host y nombre de base de datos.`,
    );
  }
  return url;
}

// Nest invokes this after merging .env and process.env, before creating providers.
export function validateRuntimeConfig(environment: Environment): Environment {
  const nodeEnv = setting(environment, 'NODE_ENV') ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV debe ser development, test o production.');
  }
  const isProduction = nodeEnv === 'production';
  shellyLocalEnabled(environment.SHELLY_LOCAL_ENABLED, nodeEnv);
  getTrustedProxies(environment.TRUSTED_PROXY_CIDRS);
  const required = ['DATABASE_URL', 'DATABASE_IOT_URL', 'JWT_SECRET'];
  const missing = required.filter(
    (name) => !setting(environment, name)?.trim(),
  );
  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno requeridas: ${missing.join(', ')}`,
    );
  }

  const application = databaseUrl(environment, 'DATABASE_URL');
  const ingest = databaseUrl(environment, 'DATABASE_IOT_URL');
  if (application.pathname !== ingest.pathname) {
    throw new Error(
      'DATABASE_URL y DATABASE_IOT_URL deben usar el mismo nombre de base de datos PostgreSQL.',
    );
  }

  if (
    isProduction &&
    Buffer.byteLength(setting(environment, 'JWT_SECRET')!.trim(), 'utf8') < 32
  ) {
    throw new Error(
      'JWT_SECRET debe contener al menos 32 bytes en producción.',
    );
  }

  const port = setting(environment, 'PORT');
  if (
    port !== undefined &&
    (!/^\d+$/.test(port) || +port < 1 || +port > 65535)
  ) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }

  const swagger = setting(environment, 'SWAGGER_ENABLED')?.trim().toLowerCase();
  if (swagger !== undefined && !['true', 'false'].includes(swagger)) {
    throw new Error('SWAGGER_ENABLED debe ser true o false.');
  }
  const sameSite = setting(environment, 'COOKIE_SAME_SITE')
    ?.trim()
    .toLowerCase();
  if (sameSite !== undefined && !['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('COOKIE_SAME_SITE debe ser lax, strict o none.');
  }
  const secure = secureCookie(environment, isProduction);
  if (isProduction && !secure) {
    throw new Error('COOKIE_SECURE debe ser true en producción.');
  }
  if (sameSite === 'none' && !secure) {
    throw new Error(
      'COOKIE_SECURE debe ser true cuando COOKIE_SAME_SITE es none.',
    );
  }
  const corsOrigins = getCorsOrigins(environment);
  if (isProduction && corsOrigins === false) {
    throw new Error(
      'FRONTEND_URL o CORS_ALLOWED_ORIGINS es requerida en producción.',
    );
  }
  return environment;
}
