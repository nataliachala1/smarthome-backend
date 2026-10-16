import { getCorsOrigins, validateRuntimeConfig } from './runtime-config';
import { shellyLocalEnabled } from './shelly-local';

// Synthetic settings only: these tests never connect to a database or broker.
const development = () => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://app@localhost/smarthome_test',
  DATABASE_IOT_URL: 'postgresql://ingest@localhost/smarthome_test',
  JWT_SECRET: 'x'.repeat(48),
});
const production = () => ({
  ...development(),
  NODE_ENV: 'production',
  CORS_ALLOWED_ORIGINS: 'https://app.example.test',
});

describe('runtime configuration', () => {
  it('preserves development configuration and the local CORS default', () => {
    const config = development();
    expect(validateRuntimeConfig(config)).toBe(config);
    expect(getCorsOrigins(config)).toEqual(['http://localhost:5173']);
  });

  it('accepts production with explicit HTTPS origins and secure cookie defaults', () => {
    expect(validateRuntimeConfig(production())).toEqual(production());
  });

  it.each(['DATABASE_URL', 'DATABASE_IOT_URL', 'JWT_SECRET'])(
    'rejects a missing %s without disclosing configuration values',
    (name) => {
      expect(() =>
        validateRuntimeConfig({ ...development(), [name]: ' ' }),
      ).toThrow(name);
    },
  );

  it.each(['prod', 'production ', 'staging'])(
    'rejects unrecognized NODE_ENV %s rather than bypassing production rules',
    (NODE_ENV) => {
      expect(() =>
        validateRuntimeConfig({ ...development(), NODE_ENV }),
      ).toThrow('NODE_ENV');
    },
  );

  it.each([
    'not-a-url',
    'https://db.example.test/data',
    'postgresql://app@localhost/',
    'postgresql://app@localhost',
  ])('rejects malformed database configuration', (DATABASE_URL) => {
    expect(() =>
      validateRuntimeConfig({ ...development(), DATABASE_URL }),
    ).toThrow('DATABASE_URL');
  });

  it('does not echo a malformed connection string in its error', () => {
    const DATABASE_URL = 'sensitive-invalid-connection-input';
    expect(() =>
      validateRuntimeConfig({ ...development(), DATABASE_URL }),
    ).toThrow(new Error('DATABASE_URL debe ser una URL PostgreSQL válida.'));
  });

  it('rejects different application and ingestion database names', () => {
    expect(() =>
      validateRuntimeConfig({
        ...development(),
        DATABASE_IOT_URL: 'postgresql://ingest@localhost/other_test',
      }),
    ).toThrow('mismo nombre');
  });

  it('rejects a short production JWT secret', () => {
    expect(() =>
      validateRuntimeConfig({ ...production(), JWT_SECRET: 'x'.repeat(31) }),
    ).toThrow('JWT_SECRET');
  });

  it.each(['0', '65536', '-1', '3000.5', '3000abc', ''])(
    'rejects an invalid PORT %s',
    (PORT) => {
      expect(() => validateRuntimeConfig({ ...development(), PORT })).toThrow(
        'PORT',
      );
    },
  );

  it.each(['false', '0', 'off', 'no'])(
    'rejects insecure production cookies even when explicitly configured as %s',
    (COOKIE_SECURE) => {
      expect(() =>
        validateRuntimeConfig({ ...production(), COOKIE_SECURE }),
      ).toThrow('COOKIE_SECURE');
    },
  );

  it('rejects SameSite=None without Secure during local development', () => {
    expect(() =>
      validateRuntimeConfig({
        ...development(),
        COOKIE_SAME_SITE: 'none',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow('COOKIE_SECURE');
  });

  it.each([
    ['COOKIE_SECURE', 'maybe'],
    ['COOKIE_SAME_SITE', 'invalid'],
    ['SWAGGER_ENABLED', 'yes'],
  ])('rejects invalid %s settings', (name, value) => {
    expect(() =>
      validateRuntimeConfig({ ...development(), [name]: value }),
    ).toThrow(name);
  });

  it('requires an explicit production origin', () => {
    expect(() =>
      validateRuntimeConfig({
        ...production(),
        CORS_ALLOWED_ORIGINS: undefined,
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS');
  });
});

describe('CORS origins', () => {
  it('normalizes and deduplicates origins without broadening the allowlist', () => {
    expect(
      getCorsOrigins({
        ...production(),
        CORS_ALLOWED_ORIGINS:
          ' https://app.example.test/, https://app.example.test, https://web.example.test:8443 ',
      }),
    ).toEqual(['https://app.example.test', 'https://web.example.test:8443']);
  });

  it('supports FRONTEND_URL for existing installations', () => {
    expect(getCorsOrigins({ FRONTEND_URL: 'http://localhost:5173/' })).toEqual([
      'http://localhost:5173',
    ]);
  });

  it.each([
    '*',
    'null',
    '',
    'https://app.example.test,',
    'https://app.example.test/private',
    'https://app.example.test?token=synthetic',
    'https://app.example.test#fragment',
    'https://user@app.example.test',
    'file:///tmp',
    'http://app.example.test',
  ])('rejects unsafe production origin %s', (CORS_ALLOWED_ORIGINS) => {
    expect(() =>
      getCorsOrigins({ ...production(), CORS_ALLOWED_ORIGINS }),
    ).toThrow('CORS_ALLOWED_ORIGINS');
  });
});

describe('local Shelly configuration', () => {
  it.each(['development', 'test', 'production'])(
    'disables local access by default in %s',
    (nodeEnv) => {
      expect(shellyLocalEnabled(undefined, nodeEnv)).toBe(false);
    },
  );

  it('allows an explicit opt-in for local development', () => {
    const config = { ...development(), SHELLY_LOCAL_ENABLED: 'true' };
    expect(validateRuntimeConfig(config)).toEqual(config);
    expect(
      shellyLocalEnabled(config.SHELLY_LOCAL_ENABLED, config.NODE_ENV),
    ).toBe(true);
  });

  it('rejects local access in production even when explicitly enabled', () => {
    expect(() =>
      validateRuntimeConfig({ ...production(), SHELLY_LOCAL_ENABLED: 'true' }),
    ).toThrow('SHELLY_LOCAL_ENABLED');
  });

  it('accepts explicitly disabled local access in production', () => {
    expect(() =>
      validateRuntimeConfig({ ...production(), SHELLY_LOCAL_ENABLED: 'false' }),
    ).not.toThrow();
  });

  it.each(['', 'yes', '1', 'TRUE', true])(
    'rejects ambiguous local-access flag %p',
    (value) => {
      expect(() =>
        validateRuntimeConfig({
          ...development(),
          SHELLY_LOCAL_ENABLED: value,
        }),
      ).toThrow('SHELLY_LOCAL_ENABLED');
    },
  );
});
