import { getTrustedProxies } from './trusted-proxies';
import { parseMqttConfig } from './mqtt-config';
import { shellyLocalEnabled } from './shelly-local';

type Environment = Record<string, unknown>;

function setting(environment: Environment, name: string): string | undefined {
  const value = environment[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
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
  throw new Error('COOKIE_SECURE must be a boolean value.');
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
        'CORS_ALLOWED_ORIGINS must contain valid HTTP origins.',
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
        'CORS_ALLOWED_ORIGINS only accepts origins, without credentials, paths or parameters.',
      );
    }
    if (isProduction && url.protocol !== 'https:') {
      throw new Error('CORS_ALLOWED_ORIGINS requires HTTPS in production.');
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
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.pathname ||
    url.pathname === '/'
  ) {
    throw new Error(
      `${name} must include protocol, user, host and database name.`,
    );
  }
  return url;
}

// Nest invokes this after merging .env and process.env, before creating providers.
export function validateRuntimeConfig(environment: Environment): Environment {
  const nodeEnv = setting(environment, 'NODE_ENV') ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test or production.');
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
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  const application = databaseUrl(environment, 'DATABASE_URL');
  const ingest = databaseUrl(environment, 'DATABASE_IOT_URL');
  if (application.pathname !== ingest.pathname) {
    throw new Error(
      'DATABASE_URL and DATABASE_IOT_URL must use the same PostgreSQL database name.',
    );
  }

  if (
    isProduction &&
    Buffer.byteLength(setting(environment, 'JWT_SECRET')!.trim(), 'utf8') < 32
  ) {
    throw new Error(
      'JWT_SECRET must contain at least 32 bytes in production.',
    );
  }

  const port = setting(environment, 'PORT');
  if (
    port !== undefined &&
    (!/^\d+$/.test(port) || +port < 1 || +port > 65535)
  ) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const swagger = setting(environment, 'SWAGGER_ENABLED')?.trim().toLowerCase();
  if (swagger !== undefined && !['true', 'false'].includes(swagger)) {
    throw new Error('SWAGGER_ENABLED must be true or false.');
  }
  const sameSite = setting(environment, 'COOKIE_SAME_SITE')
    ?.trim()
    .toLowerCase();
  if (sameSite !== undefined && !['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('COOKIE_SAME_SITE must be lax, strict or none.');
  }
  const secure = secureCookie(environment, isProduction);
  if (isProduction && !secure) {
    throw new Error('COOKIE_SECURE must be true in production.');
  }
  if (sameSite === 'none' && !secure) {
    throw new Error(
      'COOKIE_SECURE must be true when COOKIE_SAME_SITE is none.',
    );
  }
  const corsOrigins = getCorsOrigins(environment);
  if (isProduction && corsOrigins === false) {
    throw new Error(
      'FRONTEND_URL or CORS_ALLOWED_ORIGINS is required in production.',
    );
  }
  parseMqttConfig(environment);
  return environment;
}
