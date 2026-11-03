const NON_PRODUCTION_HOST = /(?:^|[-.])(dev|development|test|testing|staging|stage)(?:[-.]|$)/i;
const NON_PRODUCTION_DATABASE = /(?:^|_)(dev|development|test|testing|staging|stage)(?:_|$)/i;

/** Defense in depth for production-only MQTT database login factories. */
export function isProductionMqttDatabaseTarget(
  hostname: string,
  database: string,
  environment: string | undefined,
): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = host === '::1' || host === '::' ||
    host.startsWith('127.') || host === '0.0.0.0' ||
    host.startsWith('::ffff:127.');
  return environment === 'production' &&
    !loopback &&
    !['localhost', 'smart-home-smarthomepostgresdev-vrmtpz']
      .includes(host) &&
    !NON_PRODUCTION_HOST.test(host) && !NON_PRODUCTION_DATABASE.test(database);
}
